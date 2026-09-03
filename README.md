# teenycode

A tiny code-editing agent in TypeScript — a minimal, hackable CLI that talks to OpenAI (or any OpenAI-compatible API) and can read, list, and edit files in your working directory.

This repository is for **educational purposes**, to demonstrate the core elements of a minimal CLI coding agent, adapted from [How to Build an Agent](https://ampcode.com/notes/how-to-build-an-agent) by Amp.

## 修改

为了方便使用，我稍微修改了一下teenycode的源码。

### 使用 OpenAI 兼容接口 / 自定义模型

修改了创建 client 的代码，使其支持任意 OpenAI 兼容的服务（可参考所用服务的 API 文档，或 [OpenAI API Reference](https://platform.openai.com/docs/api-reference)）。现在需要在根目录下的 `.env` 文件中提供以下**必需**环境变量（可先 `cp .env.example .env` 再填写）：

```
BASE_URL=https://api.deepseek.com
API_KEY=sk-...
MODEL=deepseek-v4-pro
WORKSPACE=C:/path/to/your/project
```

- `WORKSPACE`：工作目录，agent 的所有工具（读/写文件、搜索、执行命令等）都被限制在该目录内，缺失时会直接退出。
- 可选：`MAX_TOOL_CALLING`（单轮最大工具调用次数，默认 64，对应 `src/index.ts`）。

## Features

- Chat-based CLI that calls OpenAI and uses tool calls
- File tools: `read_file`, `list_files`, `edit_file`，另有 `get_current_time`、`run_command`（带权限确认）、`grep`
- Prefers reading files over guessing; makes the smallest edit that satisfies a request
- Minimal dependencies and simple code you can tweak

> [!NOTE]
> 默认不开放任意 shell 命令。`run_command` 采用「白名单直接放行、黑名单直接拒绝、其余询问用户」的权限策略。
> 你可以在 `src/agent.ts` 中调整 `ALLOW_COMMANDS` / `DENY_PREFIXES`。

## Requirements

- Node.js 22+
- npm / Vite Plus
- 一个 OpenAI 兼容的 API key，并在 `.env` 中配置 `BASE_URL`、`API_KEY`、`MODEL`、`WORKSPACE`（见下方「修改」）

## Quickstart

Try it immediately, without cloning the repo (you will need your own OpenAI API key):

```sh
export API_KEY=sk-...
npx teenycode
```

Or put `API_KEY=sk-...`（以及 `BASE_URL`、`MODEL`、`WORKSPACE`）in a `.env` file in the directory where you run `npx teenycode`.

If you prefer a one-liner:

```sh
API_KEY=sk-... npx teenycode
```

Alternatively, run it from source by cloning the repo:

```sh
npm install
cp .env.example .env # Then edit .env and set API_KEY / WORKSPACE
npm start
```

You'll see a prompt like `Chat with <model>`. Type your requests. Quit with `exit`, `quit`, `:q`, or Ctrl‑C.

If `API_KEY` or `WORKSPACE` is missing, the CLI prints setup instructions and exits.

## How it works

- `src/index.ts`: Entry point; loads `.env`, checks `API_KEY` / `WORKSPACE`, parses the `-n` flag, starts the agent
- `src/env.ts`: Loads `.env` from the current working directory
- `src/agent.ts`: Chat loop, tool routing, `run_command` permission gate, and message state
- `src/tools.ts`: Six built-in tools implemented with Node `fs` / `child_process` APIs
- `src/context.ts`: Session log persistence (`-n <file>`) and `/compact` context compression

The agent uses OpenAI Chat Completions with function/tool calling. Tool inputs are validated with Zod, and schemas are exported to JSON Schema for the model.

## Example

```
➜  teenycode git:(main) ✗ API_KEY=sk-... npx teenycode

Chat with gpt-5 (type 'exit' or 'quit' or use Ctrl-C to quit)

You: What is this repo about?

Tool: list_files({"path": ""})
Tool: read_file({"path":"README.md"})
Tool: read_file({"path":"package.json"})
Tool: read_file({"path":"src/index.ts"})
Tool: read_file({"path":"src/agent.ts"})
Tool: read_file({"path":"src/tools.ts"})

Agent: TeenyCode is a tiny, hackable CLI coding agent written in TypeScript for educational purposes. It chats with OpenAI and can operate on your local files via six tools:
- read_file: read a file’s contents
- list_files: list files/dirs at a path
- edit_file: make a single, unique text replacement or create a new file
```

## Tools

The agent exposes six tools:

- `read_file` (`path: string`): Reads and returns the text contents of a file at a relative path.
- `list_files` (`path: string`): Lists files and directories at the given path (use "." for the current dir).
- `edit_file` (`path: string, old_str: string, new_str: string`): Replaces exactly one occurrence of old_str with new_str in the given file.
- `get_current_time` (): 获取该计算机的当前时间（带时区）。
- `run_command` (`command: string`): 在当前工作目录执行 shell 命令。白名单（`node --version` / `node --help`）直接放行，黑名单直接拒绝，其余命令需用户确认（y/N）。
- `grep` (`pattern: string, path?: string, include?: string, isincludesVal?: boolean`): 按关键词在文件中搜索，返回 `相对路径:行号: 该行内容`（默认跳过 `node_modules` 与 `.git`）。

Conventions:

- All paths are relative to your current working directory.
- The agent prefers reading over guessing and aims to make the smallest possible change.

## Sessions & context

- `-n <file>`：启动时把对话消息写入会话日志，下次用同一文件名启动可恢复历史（日志目录见 `src/context.ts` 顶部的 `LOG_DIR`，可按需修改为你的路径）。
- `/compact`（或 `/compact --show`）：把较早的对话压缩成摘要，控制上下文长度，随后可继续提问。
- `MAX_TOOL_CALLING`：单轮允许的最大工具调用次数，默认 64（防止模型无限循环调用工具）。

## Notes

- Edits are surgical by design. Keep your work in git and commit often.
- The agent operates relative to your current working directory.

## Local development

```sh
vp install
cp .env.example .env
# edit .env and set API_KEY / WORKSPACE
vp run start
```

## Quality checks

```sh
vp check
vp lint --fix
vp fmt
vp test
vp build
```

## Acknowledgements

Adapted from [How to Build an Agent](https://ampcode.com/notes/how-to-build-an-agent) by Amp.
