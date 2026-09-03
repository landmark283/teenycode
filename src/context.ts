import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources";
import { promises as fs } from "node:fs";
const KEEP_TURNS = 3;
export async function compact(
  messages: ChatCompletionMessageParam[],
  client: OpenAI,
  model: string,
): Promise<void> {
  const turnStarts: number[] = [];
  for (let i = 0; i < messages.length; ++i) {
    if (messages[i].role == "user") {
      turnStarts.push(i);
    }
  }
  if (turnStarts.length <= KEEP_TURNS) return;
  const lastone = turnStarts[turnStarts.length - KEEP_TURNS];
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
export async function loadSession(filename: string): Promise<ChatCompletionMessageParam[]> {
  if (!filename) return [];
  try {
    const text = await fs.readFile(LOG_DIR + filename, "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; // 没有旧日志 = 新会话
    throw err;
  }
}
