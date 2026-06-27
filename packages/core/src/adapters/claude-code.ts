import { ClaudeModelTracker } from "../model-resolution.js";
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
import { z } from "zod";

const ADAPTER_VERSION = "0.1.1";
const IGNORED_TYPES = new Set([
  "queue-operation",
  "file-history-snapshot",
  "ai-title",
  "last-prompt",
  "attachment",
]);

const claudeLineSchema = z.object({
  type: z.string().optional(),
  timestamp: z.string().optional(),
  cwd: z.string().optional(),
  sessionId: z.string().optional(),
  model: z.string().optional(),
  message: z
    .object({
      id: z.string().optional(),
      role: z.string().optional(),
      model: z.string().optional(),
      content: z.union([z.string(), z.array(z.unknown())]).optional(),
      usage: z
        .object({
          input_tokens: z.number().optional(),
          output_tokens: z.number().optional(),
          cache_read_input_tokens: z.number().optional(),
          cache_creation_input_tokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

type ClaudeContentBlock = z.infer<typeof claudeContentBlockSchema>;

const claudeContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.unknown().optional(),
    is_error: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("image"),
    source: z
      .object({
        media_type: z.string().optional(),
        data: z.string().optional(),
      })
      .optional(),
  }),
]);

function parseClaudeContentBlock(raw: unknown): ClaudeContentBlock | null {
  const parsed = claudeContentBlockSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function claudeRoot(opts: DiscoverOptions): string {
  return opts.roots?.["claude-code"] ?? join(homedir(), ".claude", "projects");
}

export const claudeCodeAdapter: Adapter = {
  tool: "claude-code" as ToolName,
  adapterVersion: ADAPTER_VERSION,
  capabilities: {
    discovery: "full",
    transcript: "full",
    toolCalls: "full",
    usage: "full",
    model: "partial",
    reasoning: "full",
    notes: [
      "Model is resolved from billable assistant usage; placeholder values like <synthetic> are ignored.",
    ],
  },

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
    const modelTracker = new ClaudeModelTracker();

    const readResult = await readJsonlLines(
      file.path,
      (line, lineNumber) => {
        const parsed = parseJsonLine(line, lineNumber, file.path);
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

        const lineParsed = claudeLineSchema.safeParse(parsed.value);
        if (!lineParsed.success) {
          builder.addWarning({
            code: "invalid_line_shape",
            message: `Line ${lineNumber}: invalid Claude record shape`,
            severity: "warn",
            scope: "parse",
            sourcePath: file.path,
            sessionId,
            line: lineNumber,
          });
          return;
        }

        const record = lineParsed.data;
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
          const usage = record.message.usage;
          const usageWeight = usage
            ? (usage.input_tokens ?? 0) +
              (usage.output_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0)
            : 0;
          modelTracker.observe(record.model ?? record.message.model, usageWeight);

          const msgId = record.message.id ?? `line-${lineNumber}`;
          const blocks = mapClaudeAssistantContent(record.message.content);
          const usageBlock = record.message.usage
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
            usage: usageBlock,
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
    session.model = modelTracker.resolve();
    yield session;
  },
};

function mapClaudeUserContent(
  content: unknown,
): Array<
  | { kind: "text"; text: string }
  | { kind: "image"; mediaType?: string; bytes?: number; note?: string }
  | { kind: "tool_result"; toolUseId: string; output?: unknown; status?: "success" | "error" }
> {
  if (!content) return [];
  if (typeof content === "string") return [{ kind: "text", text: content }];
  if (!Array.isArray(content)) return [];

  const result: ReturnType<typeof mapClaudeUserContent> = [];
  for (const raw of content) {
    const block = parseClaudeContentBlock(raw);
    if (!block) continue;
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

function mapClaudeAssistantContent(content: unknown) {
  if (!content) return [];
  if (typeof content === "string") return [{ kind: "text" as const, text: content }];
  if (!Array.isArray(content)) return [];

  const blocks: Array<
    | { kind: "text"; text: string }
    | { kind: "thinking"; text: string }
    | { kind: "tool_use"; id: string; name: string; input?: unknown }
  > = [];

  for (const raw of content) {
    const block = parseClaudeContentBlock(raw);
    if (!block) continue;
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
