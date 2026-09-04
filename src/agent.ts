import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { styleText } from "node:util";
import { toOpenAITools, type Tool } from "./tools.js";
import { promises as fs } from "node:fs";
import { compact, loadSession, push, estimateTokens } from "./context.js";
// runAgent wires together:
// - terminal I/O via readline
// - the OpenAI Chat Completions API
// - the local tool implementations (read/list/edit files)
// and loops, letting the model call tools until it produces a final reply.
export async function runAgent(
  tools: Tool[],
  max_tool_calling: number,
  sessionFile: string,
  max_tokens: number,
  keep_turns: number,
): Promise<void> {
  // OpenAI SDK client reads API_KEY/BASE_URL from env (see .env.example).
  const client = new OpenAI({
    apiKey: process.env.API_KEY,
    baseURL: process.env.BASE_URL,
  });

  // Model selection: override with MODEL, else use a sensible default.
  const model = process.env.MODEL ?? "gpt-5";

  // Convert our internal Tool descriptors into OpenAI "function tools" schema.
  const toolSpecs = toOpenAITools(tools);

  // Quick lookup table from tool name -> implementation.
  const toolByName = new Map(tools.map((t) => [t.name, t]));

  //读取项目的AGENTS.md，拼接好系统提示词
  const systemContent = await buildSystemContent();
  // Conversation state we send to the API each turn.
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemContent,
    },
  ];

  // 若 -n 指定了会话文件，恢复历史记录（追加到 system 之后）。
  const history = await loadSession(sessionFile);
  if (history.length > 0) {
    messages.push(...history);
    console.log(styleText("cyan", `已恢复 ${history.length} 条历史消息（来自 ${sessionFile}）\n`));
  }

  // Interactive terminal prompt setup.
  const rl = readline.createInterface({ input, output });

  // Handle Ctrl-C gracefully: don't surface an error, just say goodbye and exit.
  rl.on("SIGINT", () => {
    console.log(styleText("yellowBright", "Goodbye!\n"));
    rl.close();
    process.exit(0);
  });

  // ---------- 权限策略（pre-execute 瀑布） ----------
  const ALLOW_COMMANDS = ["node --version", "node --help"]; // 白名单：直接放行
  const DENY_PREFIXES = ["rm", "del", "git push", "git reset", "format", "shutdown", "mkfs"]; // 黑名单：直接拒绝

  async function checkPermission(command: string): Promise<"allow" | "deny"> {
    if (ALLOW_COMMANDS.includes(command)) return "allow";
    if (DENY_PREFIXES.some((p) => command.startsWith(p))) return "deny";
    // 其余：询问用户（HITL）
    const answer = await rl.question(
      styleText("yellowBright", `\n[权限确认] 允许执行: ${command} ? (y/N) `),
    );
    return answer.trim().toLowerCase() === "y" ? "allow" : "deny";
  }
  console.log(`Chat with ${model} (type 'exit' or 'quit' or use Ctrl-C to quit)\n`);
  let tool_calling: number = 0;

  // Outer loop: read user input, then ask the model how to respond.
  while (true) {
    //自动压缩上下文
    if (estimateTokens(messages) > max_tokens) {
      console.log(`上下文token超过了${max_tokens}，进行上下文压缩...\n`);
      await compact(messages, client, model, keep_turns, sessionFile);
      console.log("上下文压缩完成！\n");
    }
    const userInput = await rl.question(`${styleText("blueBright", "You")}: `);

    // Exit shortcuts: "exit", "quit", vi-style ":q", or Ctrl-D (\u0004).
    if (["exit", "quit", ":q", "\u0004"].includes(userInput.trim().toLowerCase())) {
      console.log(styleText("yellowBright", "Goodbye!\n"));
      rl.close();
      return;
    }

    // Ignore empty lines to keep the log cleaner.
    if (userInput.trim() === "") {
      continue;
    }

    if (userInput.trim() === "/refresh") {
      console.log("\n", messages);
      continue;
    }
    if (userInput.trim() === "/compact") {
      await compact(messages, client, model, keep_turns, sessionFile);
      console.log("上下文压缩完毕\n");
      continue;
    }
    if (userInput.trim() === "/compact --show") {
      await compact(messages, client, model, keep_turns, sessionFile);
      console.log("上下文压缩完毕\n", messages);
      continue;
    }

    // Record the user's message in the running transcript.
    await push(messages, { role: "user", content: userInput }, sessionFile);
    console.log();
    tool_calling = 0;

    // Inner loop: keep calling the model until it returns plain text.
    // If the model asks to call tools, we execute them and feed results back.
    while (true) {
      const res = await client.chat.completions.create({
        model,
        messages,
        tools: toolSpecs,
      });
      const msg = res.choices[0].message;

      // Save assistant message (either text or tool calls) to history.
      await push(messages, msg, sessionFile);

      // If there are no tool calls, we have a final answer to display.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        console.log(`${styleText("yellowBright", "Agent")}: ${msg.content ?? ""}\n`);
        break;
      }

      // 累计工具调用次数，超过上限则强制停止（防止模型无限循环调用工具）。
      tool_calling += msg.tool_calls.length;
      if (tool_calling > max_tool_calling) {
        // 为尚未回应的 tool_call 补齐 tool 消息，避免违反 OpenAI API 约束。
        for (const call of msg.tool_calls) {
          await push(
            messages,
            {
              role: "tool",
              tool_call_id: call.id,
              content: "ERROR: 工具调用次数超过设置，强制停止。",
            },
            sessionFile,
          );
        }
        console.log(styleText("redBright", "tools error: 工具调用次数超过设置，强制停止。\n"));
        break;
      }

      // Otherwise, execute each requested tool in sequence and send results back.
      for (const call of msg.tool_calls) {
        if (call.type !== "function") {
          continue; // defensive: we only support function tools
        }

        const tool = toolByName.get(call.function.name);
        console.log(
          `${styleText("gray", "Tool")}: ${call.function.name}(${call.function.arguments})\n`,
        );

        let result: string;
        try {
          if (!tool) {
            throw new Error(`Unknown tool: ${call.function.name}`);
          }

          // Tool arguments are a JSON string — parse and validate in the tool.
          const args = JSON.parse(call.function.arguments);
          if (tool.name === "run_command") {
            const verdict = await checkPermission(args.command);
            if (verdict === "deny") {
              // 用户拒绝：只把错误回喂给模型，绝不再真正执行该命令。
              await push(
                messages,
                {
                  role: "tool",
                  tool_call_id: call.id,
                  content: `ERROR: 用户拒绝了命令 "${args.command}"（权限门控）。请换一种不执行危险命令的方式，或向用户说明为什么需要它。`,
                },
                sessionFile,
              );
              console.log(styleText("redBright", "用户拒绝了命令\n"));
              continue;
            }
          }
          result = await tool.execute(args);
        } catch (err) {
          // Surface tool errors back to the model so it can recover.
          result = `ERROR: ${(err as Error).message}`;
          console.log(styleText("redBright", result + "\n"));
        }

        // Provide the tool's output to the model using the tool_call_id.
        await push(messages, { role: "tool", tool_call_id: call.id, content: result }, sessionFile);
      }
    }
  }
}

async function buildSystemContent(): Promise<string> {
  let systemContent =
    "You are a helpful coding agent with access to tools for reading, listing, and editing files in the user's working directory. Use the tools whenever they would let you answer more accurately than guessing. Prefer reading a file over asking the user to paste its contents. When editing, make the smallest change that satisfies the request. Keep replies short.";

  const files = ["AGENTS.md", "agents.md", "SKILL.md", "skill.md"];
  const existingFiles = await Promise.all(
    files.map(async (file) => {
      try {
        await fs.access(file);
        return file;
      } catch {
        return null;
      }
    }),
  );

  for (const file of existingFiles.filter(Boolean)) {
    const content = await fs.readFile(file!, "utf-8");
    // 用空行分隔，避免拼接内容粘连。
    systemContent += `\n\n${content}`;
  }

  return systemContent;
}
