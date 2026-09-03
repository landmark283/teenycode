import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

// A Tool is a capability the agent can invoke. Each tool declares:
// - a name (used by the model to call it)
// - a natural-language description (helps the model decide when to use it)
// - a Zod schema for validated inputs
// - an async execute(input) function that returns a string result
export type Tool = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  execute: (input: unknown) => Promise<string>;
};

// -------------------------
// read_file implementation
// -------------------------
const readFileInput = z.object({
  path: z.string().describe("The relative path of a file in the working directory."),
});

const readFile: Tool = {
  name: "read_file",
  description:
    "Read the contents of a given relative file path. Use this when you want to see what's inside a file. Do not use this with directory names.",
  schema: readFileInput,
  execute: async (input) => {
    // Validate and coerce the raw input using Zod.
    const { path: p } = readFileInput.parse(input);
    // Return the file contents as UTF-8 text.
    checkPath(p);
    return await fs.readFile(p, "utf8");
  },
};

// -------------------------
// list_files implementation
// -------------------------
const listFilesInput = z.object({
  path: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional relative path to list files from. Defaults to the current directory if not provided.",
    ),
});

const listFiles: Tool = {
  name: "list_files",
  description:
    "List files and directories at a given path. If no path is provided, lists files in the current directory.",
  schema: listFilesInput,
  execute: async (input) => {
    const { path: pathParam } = listFilesInput.parse(input);

    // Default to current directory when path is not provided or is null.
    const root = pathParam && pathParam !== null ? pathParam : ".";
    checkPath(root);

    // Node 20+ supports 'recursive' + 'withFileTypes' to walk a tree.
    const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });

    // Emit a flat list of relative paths; suffix directories with '/'.
    const out: string[] = [];
    for (const e of entries) {
      const rel = path.relative(root, path.join(e.parentPath ?? root, e.name));
      out.push(e.isDirectory() ? `${rel}/` : rel);
    }

    return JSON.stringify(out);
  },
};

// -------------------------
// edit_file implementation
// -------------------------
const editFileInput = z.object({
  // Path where we will edit or create a file.
  path: z.string().describe("The path to the file"),

  // If empty: create the file with new_str when it does not exist.
  // If non-empty: must appear exactly once in the target file and will be replaced.
  old_str: z
    .string()
    .describe(
      "Text to search for — must match exactly and must only have one match. Pass an empty string to create a new file with new_str as its contents.",
    ),

  // Replacement text or the initial content for a new file.
  new_str: z.string().describe("Text to replace old_str with"),
});

const editFile: Tool = {
  name: "edit_file",
  description:
    "Make edits to a text file. Replaces 'old_str' with 'new_str' in the given file. 'old_str' and 'new_str' MUST be different from each other. If the file specified with path doesn't exist and old_str is empty, it will be created with new_str as its contents.",
  schema: editFileInput,
  execute: async (input) => {
    const { path: p, old_str, new_str } = editFileInput.parse(input);

    // Sanity check to prevent accidental no-op writes.
    if (old_str === new_str) {
      throw new Error("old_str and new_str must be different");
    }

    checkPath(p);
    let content: string;
    try {
      // Try to read the file. If it does not exist and old_str === "",
      // we'll create it below.
      content = await fs.readFile(p, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" && old_str === "") {
        // Create parent directories as needed, then write new content.
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, new_str);
        return `Created ${p}`;
      }

      // Propagate any other error (e.g., permissions).
      throw err;
    }

    // If the file exists, an empty old_str would be ambiguous — disallow it.
    if (old_str === "") {
      throw new Error(`file ${p} already exists; pass a non-empty old_str to edit it`);
    }

    // Ensure a unique match so the edit is predictable and reviewable.
    const occurrences = content.split(old_str).length - 1;
    if (occurrences === 0) {
      throw new Error(`old_str not found in ${p}`);
    }

    if (occurrences > 1) {
      throw new Error(`old_str matched ${occurrences} times in ${p}; must be unique`);
    }

    await fs.writeFile(p, content.replace(old_str, new_str));
    return `Edited ${p}`;
  },
};

const getCurrentTime_ = z.object({});
const getCurrentTime: Tool = {
  name: "get_current_time",
  description:
    "获取该计算机的当前时间。模型不知道现在是几点几分，回答时间类问题时必须调用这个工具。该时间与用户所在地的时间一致。",
  schema: getCurrentTime_,
  execute: async () => {
    const now = new Date();
    const offsetHours = -now.getTimezoneOffset() / 60; // 如中国为 +8
    const sign = offsetHours >= 0 ? "+" : "";
    return `${now.toLocaleString("zh-CN", { hour12: false })}（UTC${sign}${offsetHours}）`;
  },
};

// promisify：把"回调式"的 exec 变成"promise 式"——就能 await 了
const exec = promisify(execCallback);

const runCommandInput = z.object({
  command: z.string().describe("要执行的 shell 命令，如 'node --version'"),
});

const runCommand: Tool = {
  name: "run_command",
  description:
    "在当前工作目录执行 shell 命令并返回输出。用于运行测试、编译、查看版本等。白名单直接放行；黑名单命令直接拒绝；其他命令会询问用户，经用户确认（y）后才执行。",
  schema: runCommandInput,
  execute: async (input) => {
    const { command } = runCommandInput.parse(input);
    try {
      // timeout: 30 秒上限，防止命令卡死（呼应"轮数上限"的同一思想）
      const { stdout, stderr } = await exec(command, {
        cwd: process.env.WORKSPACE,
        encoding: "utf8",
        timeout: 30000,
      });
      return stdout || stderr || "(命令无输出)";
    } catch (err) {
      // 错误回喂！W1-D3 学的自愈在这里复用
      return `ERROR: ${(err as Error).message}`;
    }
  },
};

const grepInput = z.object({
  pattern: z.string().describe("要搜索的关键词（大小写不敏感）"),
  path: z.string().optional().describe("要搜索的目录，默认当前目录"),
  include: z.string().optional().describe("只搜文件名以该后缀结尾的文件，如 '.ts'"),
  isincludesVal: z
    .boolean()
    .optional()
    .describe("是否跳过依赖目录（如 node_modules ），默认跳过。"),
});

const grep: Tool = {
  name: "grep",
  description:
    "按关键词在文件中搜索，返回『相对路径:行号: 该行内容』列表。用于定位代码出现的位置，如某个函数被调用了几次、某句话出现在哪些文件。pattern 是普通关键词（非正则表达式），如搜 console.log 直接写 console.log，不要写 console\\.log。默认跳过 node_modules 和 .git。",
  schema: grepInput,
  execute: async (input) => {
    const { pattern, path: root = ".", include, isincludesVal = true } = grepInput.parse(input);
    checkPath(root);

    const matches: string[] = [];
    const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });

    for (const e of entries) {
      if (!e.isFile()) continue;
      // 跳过依赖目录，否则又慢又刷屏
      if (isincludesVal && (e.parentPath.includes("node_modules") || e.parentPath.includes(".git")))
        continue;
      if (include && !e.name.endsWith(include)) continue;

      // full：从 cwd 出发的完整相对路径 → 用它读取
      // display：同样从 cwd 出发（path.join 自动消掉 "."）→ 模型可直接拿去 read_file
      const full = path.join(e.parentPath ?? root, e.name);
      const display = full.replace(/\\/g, "/");

      const lines = (await fs.readFile(full, "utf8")).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
          matches.push(`${display}:${i + 1}: ${lines[i].trim()}`);
          if (matches.length >= 50) {
            return matches.join("\n") + "\n...(已截断，请缩小搜索范围)";
          }
        }
      }
    }
    // 无匹配不是错误——模型需要知道"没找到"，然后换词重搜
    return matches.length ? matches.join("\n") : "未找到匹配";
  },
};

// Export the built-in tool list the agent will load.
export const tools: Tool[] = [readFile, listFiles, editFile, getCurrentTime, runCommand, grep];

// Transform our Tool definitions into the structure the OpenAI client expects
// for "function tools". We also convert the Zod schema to JSON Schema so the
// model knows the input shape.
export function toOpenAITools(tools: Tool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema) as Record<string, unknown>,
    },
  }));
}

function checkPath(p: string): void {
  if (p.includes("//") || p.includes("\\\\")) {
    throw new Error("do not use '//' or '\\\\' in workplace path");
  }

  // 防止越权读取/修改工作目录之外的文件（绝对路径、../ 穿越等）。
  const resolved = path.resolve(p);
  const cwd = path.resolve(".");
  const rel = path.relative(cwd, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path "${p}" escapes the working directory`);
  }
}
