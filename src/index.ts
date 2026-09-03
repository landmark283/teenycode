// Entry point for the TeenyCode CLI.
//
// - Loads the agent and the built-in filesystem tools
// - Verifies your OpenAI API key is available
// - Starts an interactive chat loop
//
// Quickstart:
//   1) export API_KEY=sk-... (optionally BASE_URL / MODEL)
//   2) npx teenycode
// Optional: set MAX_TOOL_CALLING to override the tool-call limit (default 64).

import { runAgent } from "./agent.js";
import { loadEnvFromCurrentWorkingDirectory } from "./env.js";
import { tools } from "./tools.js";

loadEnvFromCurrentWorkingDirectory();

// 需要配置使用AI的 BASE_URL、API_KEY 以及模型名称，具体见 README。
if (!process.env.API_KEY) {
  console.error(
    "API_KEY is not set.\n\nRun:\n  export API_KEY=sk-...\n  npx teenycode\n\nOr create a .env file in the current directory.\n",
  );
  process.exit(1);
}

if (!process.env.WORKSPACE) {
  console.error(
    "WORKSPACE is not set.\n\nRun:\n  export WORKSPACE=C:/.....\n  npx teenycode\n\nOr create a .env file in the current directory.\n",
  );
  process.exit(1);
}
let maxToolCalling: number = 64;
if (process.env.MAX_TOOL_CALLING) {
  const parsedMax = Number(process.env.MAX_TOOL_CALLING);
  if (Number.isFinite(parsedMax) && parsedMax > 0) {
    maxToolCalling = parsedMax;
  }
}

// -n <文件名>：指定会话日志文件名（记录新消息 + 启动时恢复该日志）
let sessionFile: string = "";
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "-n") {
    sessionFile = argv[i + 1] ?? "";
    if (!sessionFile) {
      console.error("-n 需要一个文件名参数，如: node --import tsx src/index.ts -n session1");
      process.exit(1);
    }
    i++; // 跳过参数值
  }
}

// Boot the agent with our toolset. Any unhandled errors are logged and we exit
// with a non-zero code so shells/CI can detect failure.
runAgent(tools, maxToolCalling, sessionFile).catch((err) => {
  console.error(err);
  console.error(); // extra newline for readability
  process.exit(1);
});
