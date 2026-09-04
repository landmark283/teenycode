import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources";
import { promises as fs } from "node:fs";

// 压缩检查点标记：压缩发生时往日志**追加**一行带此标记的摘要消息。
// 日志文件永远 append、永不重写（完整历史 = 审计记录）。
// 加载（loadSession）时读到带此标记的行 → 在内存里清空之前的对话，
// 该行本身作为摘要 user 消息保留，之后的行正常加载。
const CHECKPOINT_FLAG = "__compaction_checkpoint__";

export async function compact(
  messages: ChatCompletionMessageParam[],
  client: OpenAI,
  model: string,
  keep_turns: number = 3,
  filename: string = "",
): Promise<void> {
  const turnStarts: number[] = [];
  for (let i = 0; i < messages.length; ++i) {
    if (messages[i].role == "user") {
      turnStarts.push(i);
    }
  }
  if (turnStarts.length <= keep_turns) return;
  const lastone = turnStarts[turnStarts.length - keep_turns];
  const compactMessages = messages.slice(1, lastone);
  const ms: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "你是对话压缩引擎，请将以下对话进行压缩，要求语言简洁，仅叙述事实。保留对话中的任务历史，记录解决问题的具体方法（报错与修复），已完成的改动，还没有完成的任务，丢弃没有意义的工具调用对话和思考过程。",
    },
    ...compactMessages,
  ];
  const res = await client.chat.completions.create({
    model,
    messages: ms,
  });
  const compacted = res.choices[0].message.content ?? "";
  if (compacted.length === 0) {
    throw Error("compact error: 返回了空的对话\n");
  }
  messages.splice(1, lastone - 1, {
    role: "user",
    content: compacted,
  });

  // 压缩后往日志末尾追加"标记摘要行"，旧历史行原样保留。
  if (filename) {
    await appendCheckpoint(compacted, filename);
  }
}

// 往日志末尾追加一条带压缩标记的摘要消息（不删除任何已有行）。
async function appendCheckpoint(summary: string, filename: string): Promise<void> {
  await ensureDir();
  const line = JSON.stringify({
    role: "user",
    content: summary,
    [CHECKPOINT_FLAG]: true,
  });
  await fs.appendFile(LOG_DIR + filename, line + "\n", "utf8");
}

const LOG_DIR = "D:\\lg\\else\\my-agent-logs\\";
let dirReady = false;

async function ensureDir() {
  if (dirReady) return;
  await fs.mkdir(LOG_DIR, { recursive: true });
  dirReady = true;
}

// 写入并持久化一条消息。filename 为空 = 不落盘（纯内存会话）。
export async function push(
  messages: ChatCompletionMessageParam[],
  message: ChatCompletionMessageParam,
  filename: string,
) {
  messages.push(message);
  if (!filename) return; // 未指定 -n：不写日志，行为与原来一致
  try {
    await ensureDir();
    await fs.appendFile(LOG_DIR + filename, JSON.stringify(message) + "\n", "utf8");
  } catch (err) {
    console.error("写日志出错：", (err as Error).message);
  }
}

// 启动时按 -n 指定的文件名恢复历史（文件不存在 = 新会话，返回空）。
// 日志文件是完整的 append-only 历史，永不被修改；
// 此处仅在"内存结果数组"里做投影：读到压缩标记行（__compaction_checkpoint__）时，
// 丢弃它之前的对话行，把标记行本身作为摘要 user 消息保留，之后的行正常加载。
export async function loadSession(filename: string): Promise<ChatCompletionMessageParam[]> {
  if (!filename) return [];
  try {
    const text = await fs.readFile(LOG_DIR + filename, "utf8");
    const result: ChatCompletionMessageParam[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const obj = JSON.parse(trimmed);
      // 遇到压缩标记：内存里丢弃此前所有行；标记行（含摘要）去标记后保留
      if (obj[CHECKPOINT_FLAG]) {
        result.length = 0;
        const { [CHECKPOINT_FLAG]: _flag, ...summaryMsg } = obj;
        result.push(summaryMsg as ChatCompletionMessageParam);
        continue;
      }
      result.push(obj as ChatCompletionMessageParam);
    }
    return result;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; // 没有旧日志 = 新会话
    throw err;
  }
}

export function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  // DSH token-meter 同款启发式：序列化长度 / 4
  return messages.reduce((n, m) => n + JSON.stringify(m).length / 4, 0);
}
