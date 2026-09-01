# teenycode

A tiny code‑editing agent in TypeScript (200 LOC) — a minimal, hackable CLI that talks to OpenAI and can read, list, and edit files in your working directory.

This repository is for **educational purposes**, to demonstrate the core elements of a minimal CLI coding agent, adapted from [How to Build an Agent](https://ampcode.com/notes/how-to-build-an-agent) by Amp.

## 修改

为了方便使用，我稍微修改了一下teenycode的源码。

### 支持使用其他模型（仅支持openai格式）

参考 '概念：相关包简介.md' 或 官方文档。
修改了创建client的代码。现在需要在根目录下的 .env 文件中提供以下环境变量：

```
BASE_URL=https://api.deepseek.com
API_KEY=sk-...
MODEL=deepseek-v4-pro
```

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
- An OpenAI-compatible API key（在 `.env` 中配置 `BASE_URL`、`API_KEY`、`MODEL`，见下方「修改」）

## Quickstart

Try it immediately, without cloning the repo (you will need your own OpenAI API key):

```sh
export API_KEY=sk-...
npx teenycode
```

Or put `API_KEY=sk-...`（以及 `BASE_URL`、`MODEL`）in a `.env` file in the directory where you run `npx teenycode`.

If you prefer a one-liner:

```sh
API_KEY=sk-... npx teenycode
```

Alternatively, run it from source by cloning the repo:

```sh
npm install
cp .env.example .env # Then edit .env and set API_KEY
npm start
```

You'll see a prompt like `Chat with <model>`. Type your requests. Quit with `exit`, `quit`, `:q`, or Ctrl‑C.

If `API_KEY` is missing, the CLI prints setup instructions and exits.

## How it works

- `src/index.ts`: Entry point; checks `API_KEY`, starts the agent
- `src/agent.ts`: Chat loop, tool routing, and message state
- `src/tools.ts`: Six built-in tools implemented with Node `fs` APIs

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

Agent: TeenyCode is a tiny, hackable CLI coding agent written in TypeScript (~200 LOC) for educational purposes. It chats with OpenAI and can operate on your local files via six tools:
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
- `grep` (`pattern: string`): 按关键词在文件中搜索，返回 `相对路径:行号: 该行内容`。

Conventions:

- All paths are relative to your current working directory.
- The agent prefers reading over guessing and aims to make the smallest possible change.

## Notes

- Edits are surgical by design. Keep your work in git and commit often.
- The agent operates relative to your current working directory.

## Local development

```sh
vp install
cp .env.example .env
# edit .env and set your API key
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
