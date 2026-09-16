import { ClaudeModelTracker } from "../model-resolution.js";
import { ParseContext, scanSource } from "../parse-context.js";
import { SessionBuilder } from "../session-builder.js";
import { detectRootAccess } from "../fs-walk.js";
import type {
  Adapter,
  DiscoverOptions,
  InputContentBlock,
  ParseOptions,
  Session,
  SessionFile,
  ToolName,
} from "../types.js";
import {
  claudeProjectSlugFromPath,
  claudeSubagentFromPath,
  decodeClaudeProjectSlug,
  parseJsonLine,
  sessionFileNameId,
} from "../util.js";
import { lstat, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import {
  ADAPTER_VERSIONS,
  CLAUDE_IGNORED_LINE_TYPES,
  DEFAULT_LOG_ROOT_SEGMENTS,
} from "../constants.js";

const claudeLineEnvelope = z
  .object({
    type: z.string().optional(),
    timestamp: z.string().optional(),
    cwd: z.string().optional(),
    sessionId: z.string().optional(),
    model: z.string().optional(),
    gitBranch: z.string().optional(),
    agentId: z.string().optional(),
    message: z.unknown().optional(),
  })
  .passthrough();

const claudeMessageSchema = z
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
      .passthrough()
      .optional(),
  })
  .passthrough();

const claudeMetaSchema = z
  .object({
    agentType: z.string().optional(),
    description: z.string().optional(),
    model: z.string().optional(),
    spawnDepth: z.number().optional(),
    toolUseId: z.string().optional(),
  })
  .passthrough();

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

function parseClaudeContentBlock(
  raw: unknown,
): ClaudeContentBlock | { unknownType: string } | null {
  const parsed = claudeContentBlockSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (raw && typeof raw === "object" && "type" in raw && typeof raw.type === "string") {
    return { unknownType: raw.type };
  }
  return null;
}

function claudeRoot(opts: DiscoverOptions): string {
  return (
    opts.roots?.["claude-code"] ?? join(homedir(), ...DEFAULT_LOG_ROOT_SEGMENTS["claude-code"])
  );
}

async function readAgentMeta(
  jsonlPath: string,
): Promise<z.infer<typeof claudeMetaSchema> | undefined> {
  const metaPath = jsonlPath.replace(/\.jsonl$/i, ".meta.json");
  try {
    const raw = await readFile(metaPath, "utf8");
    const parsed = claudeMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export const claudeCodeAdapter: Adapter = {
  tool: "claude-code" as ToolName,
  adapterVersion: ADAPTER_VERSIONS["claude-code"],
  capabilities: {
    discovery: "full",
    transcript: "full",
    toolCalls: "full",
    usage: "full",
    model: "partial",
    reasoning: "full",
    notes: [
      "Model is resolved from billable assistant usage; placeholder values like <synthetic> are ignored.",
      "Subagent transcripts are discovered under <sessionId>/subagents/agent-*.jsonl.",
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
        entryStat = await lstat(projectDir);
      } catch {
        continue;
      }
      if (entryStat.isSymbolicLink()) continue;

      if (!entryStat.isDirectory()) {
        if (entryStat.isFile() && slug.endsWith(".jsonl")) {
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
        const path = join(projectDir, file);
        let fileStat;
        try {
          fileStat = await lstat(path);
        } catch {
          continue;
        }
        if (fileStat.isSymbolicLink()) continue;
        if (fileStat.isFile() && file.endsWith(".jsonl")) {
          yield { path, tool: "claude-code" };
          continue;
        }
        if (!fileStat.isDirectory()) continue;

        const subagentsDir = file === "subagents" ? path : join(path, "subagents");
        let subStat;
        try {
          subStat = await lstat(subagentsDir);
        } catch {
          continue;
        }
        if (subStat.isSymbolicLink() || !subStat.isDirectory()) continue;
        let agents: string[];
        try {
          agents = await readdir(subagentsDir);
        } catch {
          continue;
        }
        for (const agentFile of agents) {
          if (!agentFile.startsWith("agent-") || !agentFile.endsWith(".jsonl")) continue;
          const agentPath = join(subagentsDir, agentFile);
          try {
            const agentStat = await lstat(agentPath);
            if (agentStat.isSymbolicLink() || !agentStat.isFile()) continue;
          } catch {
            continue;
          }
          yield { path: agentPath, tool: "claude-code" };
        }
      }
    }
  },

  async *parse(file: SessionFile, opts: ParseOptions): AsyncIterable<Session> {
    const subagent = claudeSubagentFromPath(file.path);
    const sessionId = subagent?.agentId ?? sessionFileNameId(file.path);
    const slug = claudeProjectSlugFromPath(file.path);
    const projectPath = decodeClaudeProjectSlug(slug);
    const meta = subagent ? await readAgentMeta(file.path) : undefined;

    const builder = new SessionBuilder({
      tool: "claude-code",
      adapterVersion: ADAPTER_VERSIONS["claude-code"],
      sourcePath: file.path,
      sessionId,
      projectPath,
      maxTurnChars: opts.maxTurnChars,
      maxToolOutputChars: opts.maxToolOutputChars,
    });
    if (subagent) {
      builder.setLineage({
        parentSessionId: subagent.parentSessionId,
        agentId: subagent.agentId,
        agentType: meta?.agentType,
        depth: meta?.spawnDepth,
      });
    }
    if (meta?.model) builder.setModel(meta.model);

    const ctx = new ParseContext({
      tool: "claude-code",
      sourcePath: file.path,
      sessionId,
    });
    const modelTracker = new ClaudeModelTracker();
    let resolvedProjectPath = projectPath;

    await scanSource(file.path, ctx, opts, (line, lineNumber) => {
      const parsed = parseJsonLine(line, lineNumber, file.path);
      if (!parsed.ok) {
        ctx.malformed(parsed.error, lineNumber);
        return;
      }

      const lineParsed = claudeLineEnvelope.safeParse(parsed.value);
      if (!lineParsed.success) {
        ctx.malformed(`Line ${lineNumber}: invalid Claude record shape`, lineNumber);
        return;
      }

      const record = lineParsed.data;
      if (!record.type) {
        ctx.unknown();
        return;
      }
      if (CLAUDE_IGNORED_LINE_TYPES.has(record.type)) {
        ctx.ignoredKnown(record.type);
        return;
      }

      if (record.cwd) resolvedProjectPath = record.cwd;
      if (typeof record.gitBranch === "string") builder.setBranch(record.gitBranch);

      const message = claudeMessageSchema.safeParse(record.message);
      const msg = message.success ? message.data : undefined;

      if (record.type === "user" && msg) {
        ctx.recognized(record.type);
        const blocks = mapClaudeUserContent(msg.content, ctx);
        const toolResults = blocks.filter((b) => b.kind === "tool_result");
        const otherBlocks = blocks.filter(
          (b): b is Exclude<(typeof blocks)[number], { kind: "tool_result" }> =>
            b.kind !== "tool_result",
        );

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

      if (record.type === "assistant" && msg) {
        ctx.recognized(record.type);
        const usage = msg.usage;
        const usageWeight = usage
          ? (usage.input_tokens ?? 0) +
            (usage.output_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0)
          : 0;
        modelTracker.observe(record.model ?? msg.model, usageWeight);

        const msgId = msg.id ?? `line-${lineNumber}`;
        const blocks = mapClaudeAssistantContent(msg.content, ctx);
        const usageBlock = msg.usage
          ? {
              inputTokens: msg.usage.input_tokens,
              outputTokens: msg.usage.output_tokens,
              cacheReadTokens: msg.usage.cache_read_input_tokens,
              cacheWriteTokens: msg.usage.cache_creation_input_tokens,
              totalTokens:
                (msg.usage.input_tokens ?? 0) +
                (msg.usage.output_tokens ?? 0) +
                (msg.usage.cache_read_input_tokens ?? 0) +
                (msg.usage.cache_creation_input_tokens ?? 0),
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
        return;
      }

      ctx.unknown(record.type);
    });

    builder.setProjectPath(resolvedProjectPath);
    const resolvedModel = modelTracker.resolve() ?? meta?.model;
    if (resolvedModel) builder.setModel(resolvedModel);
    for (const warning of ctx.drainWarnings()) builder.addWarning(warning);
    builder.setFidelity(ctx.finalize());
    yield builder.finalize();
  },
};

function mapClaudeUserContent(
  content: unknown,
  ctx: ParseContext,
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
    if ("unknownType" in block) {
      ctx.unknownContentBlock(block.unknownType);
      continue;
    }
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

function mapClaudeAssistantContent(content: unknown, ctx: ParseContext): InputContentBlock[] {
  if (!content) return [];
  if (typeof content === "string") return [{ kind: "text", text: content }];
  if (!Array.isArray(content)) return [];

  const blocks: InputContentBlock[] = [];
  for (const raw of content) {
    const block = parseClaudeContentBlock(raw);
    if (!block) continue;
    if ("unknownType" in block) {
      ctx.unknownContentBlock(block.unknownType);
      continue;
    }
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
