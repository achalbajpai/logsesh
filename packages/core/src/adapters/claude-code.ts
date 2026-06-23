import { SessionBuilder } from "../session-builder.js";
import { detectRootAccess } from "../fs-walk.js";
import type {
  Adapter,
  DiscoverOptions,
  ParseOptions,
  Session,
  SessionFile,
  ToolName,
} from "../types.js";
import {
  decodeClaudeProjectSlug,
  parseJsonLine,
  readJsonlLines,
  sessionFileNameId,
} from "../util.js";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const ADAPTER_VERSION = "0.1.0";
const IGNORED_TYPES = new Set([
  "queue-operation",
  "file-history-snapshot",
  "ai-title",
  "last-prompt",
  "attachment",
]);

interface ClaudeLine {
  type?: string;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  message?: {
    id?: string;
    role?: string;
    content?: string | ClaudeContentBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input?: unknown }
  | { type: "tool_result"; tool_use_id: string; content?: unknown; is_error?: boolean }
  | { type: "image"; source?: { media_type?: string; data?: string } };

function claudeRoot(opts: DiscoverOptions): string {
  return opts.roots?.["claude-code"] ?? join(homedir(), ".claude", "projects");
}

export const claudeCodeAdapter: Adapter = {
  tool: "claude-code" as ToolName,
  adapterVersion: ADAPTER_VERSION,

  async detect(): Promise<boolean> {
    const { accessible } = await detectRootAccess(claudeRoot({}), "claude-code");
    return accessible;
  },

  async *discover(opts: DiscoverOptions): AsyncIterable<SessionFile> {
    const root = claudeRoot(opts);
    let projects: string[];
    try {
      projects = await readdir(root);
    } catch {
      return;
    }

    for (const slug of projects) {
      const projectDir = join(root, slug);
      let entryStat;
      try {
        entryStat = await stat(projectDir);
      } catch {
        continue;
      }

      if (!entryStat.isDirectory()) {
        if (slug.endsWith(".jsonl")) {
          yield { path: projectDir, tool: "claude-code" };
        }
        continue;
      }

      let files: string[];
      try {
        files = await readdir(projectDir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        yield { path: join(projectDir, file), tool: "claude-code" };
      }
    }
  },

  async *parse(file: SessionFile, opts: ParseOptions): AsyncIterable<Session> {
    const sessionId = sessionFileNameId(file.path);
    const slug = file.path.split("/").slice(-2, -1)[0] ?? "";
    const projectPath = decodeClaudeProjectSlug(slug);

    const builder = new SessionBuilder({
      tool: "claude-code",
      adapterVersion: ADAPTER_VERSION,
      sourcePath: file.path,
      sessionId,
      projectPath,
      maxTurnChars: opts.maxTurnChars,
      maxToolOutputChars: opts.maxToolOutputChars,
    });

    let resolvedProjectPath = projectPath;

    const readResult = await readJsonlLines(
      file.path,
      (line, lineNumber) => {
        const parsed = parseJsonLine<ClaudeLine>(line, lineNumber, file.path);
        if (!parsed.ok) {
          builder.addWarning({
            code: "malformed_line",
            message: parsed.error,
            severity: "warn",
            scope: "parse",
            sourcePath: file.path,
            sessionId,
            line: lineNumber,
          });
          return;
        }

        const record = parsed.value;
        if (!record.type || IGNORED_TYPES.has(record.type)) return;

        if (record.cwd) resolvedProjectPath = record.cwd;

        if (record.type === "user" && record.message) {
          const blocks = mapClaudeUserContent(record.message.content);
          const toolResults = blocks.filter((b) => b.kind === "tool_result");
          const otherBlocks = blocks.filter((b) => b.kind !== "tool_result");

          if (otherBlocks.length > 0) {
            builder.addRecord({
              role: "user",
              sourceLine: lineNumber,
              blocks: otherBlocks,
              timestamp: record.timestamp,
            });
          }

          for (const tr of toolResults) {
            if (tr.kind !== "tool_result") continue;
            builder.addToolResult({
              toolUseId: tr.toolUseId,
              sourceLine: lineNumber,
              output: tr.output,
              status: tr.status,
            });
          }
          return;
        }

        if (record.type === "assistant" && record.message) {
          const msgId = record.message.id ?? `line-${lineNumber}`;
          const blocks = mapClaudeAssistantContent(record.message.content);
          const usage = record.message.usage
            ? {
                inputTokens: record.message.usage.input_tokens,
                outputTokens: record.message.usage.output_tokens,
                cacheReadTokens: record.message.usage.cache_read_input_tokens,
                cacheWriteTokens: record.message.usage.cache_creation_input_tokens,
                totalTokens:
                  (record.message.usage.input_tokens ?? 0) +
                  (record.message.usage.output_tokens ?? 0) +
                  (record.message.usage.cache_read_input_tokens ?? 0) +
                  (record.message.usage.cache_creation_input_tokens ?? 0),
              }
            : undefined;

          builder.addRecord({
            role: "assistant",
            fragmentGroupId: msgId,
            sourceLine: lineNumber,
            blocks,
            usage,
            timestamp: record.timestamp,
          });
        }
      },
      { maxFileBytes: opts.maxFileBytes },
    );

    if (readResult.skipped) {
      builder.addWarning({
        code: "file_too_large",
        message: `File exceeds max size (${readResult.size} bytes), skipped`,
        severity: "warn",
        scope: "parse",
        sourcePath: file.path,
        sessionId,
      });
    }

    const session = builder.finalize();
    session.projectPath = resolvedProjectPath;
    yield session;
  },
};

function mapClaudeUserContent(
  content: string | ClaudeContentBlock[] | undefined,
): Array<
  | { kind: "text"; text: string }
  | { kind: "image"; mediaType?: string; bytes?: number; note?: string }
  | { kind: "tool_result"; toolUseId: string; output?: unknown; status?: "success" | "error" }
> {
  if (!content) return [];
  if (typeof content === "string") return [{ kind: "text", text: content }];

  const result: ReturnType<typeof mapClaudeUserContent> = [];
  for (const block of content) {
    if (block.type === "text") {
      result.push({ kind: "text", text: block.text });
    } else if (block.type === "image") {
      const data = block.source?.data;
      result.push({
        kind: "image",
        mediaType: block.source?.media_type,
        bytes: data ? data.length : undefined,
        note: "[image omitted]",
      });
    } else if (block.type === "tool_result") {
      result.push({
        kind: "tool_result",
        toolUseId: block.tool_use_id,
        output: block.content,
        status: block.is_error ? "error" : "success",
      });
    }
  }
  return result;
}

function mapClaudeAssistantContent(content: string | ClaudeContentBlock[] | undefined) {
  if (!content) return [];
  if (typeof content === "string") return [{ kind: "text" as const, text: content }];

  const blocks: Array<
    | { kind: "text"; text: string }
    | { kind: "thinking"; text: string }
    | { kind: "tool_use"; id: string; name: string; input?: unknown }
  > = [];

  for (const block of content) {
    if (block.type === "text") {
      blocks.push({ kind: "text", text: block.text });
    } else if (block.type === "thinking") {
      blocks.push({ kind: "thinking", text: block.thinking });
    } else if (block.type === "tool_use") {
      blocks.push({ kind: "tool_use", id: block.id, name: block.name, input: block.input });
    }
  }
  return blocks;
}
