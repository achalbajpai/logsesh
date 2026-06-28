import { z } from "zod";

const toolNameSchema = z.enum(["claude-code", "codex", "gemini"]);

const contentBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("thinking"), text: z.string() }),
  z.object({
    kind: z.literal("image"),
    mediaType: z.string().optional(),
    bytes: z.number().optional(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal("tool_result"),
    toolUseId: z.string(),
    output: z.unknown().optional(),
    status: z.enum(["success", "error"]).optional(),
  }),
]);

const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["info", "warn", "error"]),
  scope: z.enum(["discovery", "parse", "export", "package", "pricing"]),
  sourcePath: z.string().optional(),
  sessionId: z.string().optional(),
  line: z.number().optional(),
  cause: z.string().optional(),
});

const publicWarningSchema = warningSchema.omit({ sourcePath: true });

const usageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
  totalTokens: z.number().optional(),
});

const estimateSchema = z.object({
  costUsd: z.number().nullable(),
  pricingVersion: z.string(),
  pricingAsOf: z.string(),
  pricingSourceUrl: z.string().optional(),
  model: z.string().optional(),
  pricingConfidence: z.enum(["exact", "historical", "fallback", "unknown"]).optional(),
  pricingProvenance: z
    .object({
      provider: z.string(),
      model: z.string(),
      sourceUrl: z.string(),
      verifiedAt: z.string(),
      effectiveFrom: z.string().optional(),
      status: z.enum(["current", "historical", "retired"]).optional(),
      availability: z.enum(["available", "restricted", "retired"]).optional(),
    })
    .optional(),
  includesCacheTokens: z.boolean(),
  warnings: z.array(z.string()).optional(),
});

export const sessionSchema = z.object({
  schemaVersion: z.literal("logsesh.session.v1"),
  id: z.string(),
  source: z.object({
    tool: toolNameSchema,
    adapterVersion: z.string(),
    logFormatVersion: z.union([z.string(), z.literal("unknown")]).optional(),
    sourcePath: z.string(),
  }),
  tool: toolNameSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  projectPath: z.string().optional(),
  model: z.string().optional(),
  usage: usageSchema.optional(),
  costUsd: z.number().nullable(),
  estimate: estimateSchema.optional(),
  turns: z.array(
    z.object({
      id: z.string(),
      index: z.number(),
      timestamp: z.string().optional(),
      role: z.enum(["user", "assistant", "tool"]),
      content: z.array(contentBlockSchema),
      toolCalls: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            input: z.unknown().optional(),
            output: z.unknown().optional(),
            status: z.enum(["success", "error"]).optional(),
          }),
        )
        .optional(),
    }),
  ),
  warnings: z.array(warningSchema).optional(),
});

const publicContentBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("image"),
    mediaType: z.string().optional(),
    bytes: z.number().optional(),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal("tool_result"),
    toolUseId: z.string(),
    output: z.unknown().optional(),
    status: z.enum(["success", "error"]).optional(),
  }),
]);

const publicTurnSchema = z.object({
  id: z.string(),
  index: z.number(),
  timestamp: z.string().optional(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.array(publicContentBlockSchema),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        input: z.unknown().optional(),
        output: z.unknown().optional(),
        status: z.enum(["success", "error"]).optional(),
      }),
    )
    .optional(),
});

export const publicSessionSchema = z.object({
  schemaVersion: z.literal("logsesh.session.v1"),
  id: z.string(),
  source: z.object({
    tool: toolNameSchema,
    adapterVersion: z.string(),
    logFormatVersion: z.union([z.string(), z.literal("unknown")]).optional(),
  }),
  tool: toolNameSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  projectPath: z.string().optional(),
  model: z.string().optional(),
  usage: usageSchema.optional(),
  costUsd: z.number().nullable(),
  estimate: estimateSchema.optional(),
  turns: z.array(publicTurnSchema),
  warnings: z.array(publicWarningSchema).optional(),
});

const sessionSummarySchema = z.object({
  id: z.string(),
  tool: toolNameSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  projectPath: z.string().optional(),
  turnCount: z.number(),
  totalTokens: z.number().optional(),
  costUsd: z.number().nullable(),
  estimate: estimateSchema.optional(),
  sourcePath: z.string(),
});

export const listEnvelopeSchema = z.object({
  format: z.literal("logsesh.list.v1"),
  generatedAt: z.string(),
  sessions: z.array(sessionSummarySchema),
  warnings: z.array(publicWarningSchema).optional(),
});

const searchMatchSchema = z.object({
  sessionId: z.string(),
  tool: toolNameSchema,
  projectPath: z.string().optional(),
  timestamp: z.string().optional(),
  snippets: z.array(z.string()),
  totalHits: z.number(),
});

export const searchEnvelopeSchema = z.object({
  format: z.literal("logsesh.search.v1"),
  generatedAt: z.string(),
  matches: z.array(searchMatchSchema),
  warnings: z.array(publicWarningSchema).optional(),
});

const tokenBreakdownSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  observed: z.object({
    input: z.boolean(),
    output: z.boolean(),
    cacheRead: z.boolean(),
    cacheWrite: z.boolean(),
    reasoning: z.boolean(),
  }),
  observedSessionCount: z.number(),
});

const statsReportSchema = z.object({
  sessionCount: z.number(),
  turnCount: z.number(),
  totalTokens: z.number(),
  loggedCostUsd: z.number().nullable(),
  loggedSessionCount: z.number(),
  estimatedCostUsd: z.number().nullable(),
  estimatedSessionCount: z.number(),
  unpricedSessionCount: z.number(),
  unpricedTokens: z.number(),
  byTool: z.record(
    z.string(),
    z.object({ sessions: z.number(), turns: z.number(), tokens: z.number() }),
  ),
  byProject: z.record(
    z.string(),
    z.object({ sessions: z.number(), turns: z.number(), tokens: z.number() }),
  ),
  mostActiveDays: z.array(z.object({ date: z.string(), sessions: z.number(), turns: z.number() })),
  dailyBurn: z.array(
    z.object({ date: z.string(), sessions: z.number(), turns: z.number(), tokens: z.number() }),
  ),
  tokenBreakdown: tokenBreakdownSchema,
});

export const statsEnvelopeSchema = z.object({
  format: z.literal("logsesh.stats.v1"),
  generatedAt: z.string(),
  stats: statsReportSchema,
  warnings: z.array(publicWarningSchema).optional(),
});

export const debugEnvelopeSchema = z.object({
  format: z.literal("logsesh.debug.v1"),
  generatedAt: z.string(),
  session: sessionSchema,
  warnings: z.array(publicWarningSchema).optional(),
});

export const jsonExportEnvelopeSchema = z.object({
  format: z.literal("logsesh.export.v1"),
  generatedAt: z.string(),
  granularity: z.enum(["session", "turn"]),
  records: z.array(z.unknown()),
  warnings: z.array(publicWarningSchema).optional(),
});

export const jsonlRecordSchema = z.object({
  format: z.literal("logsesh.jsonl.v1"),
  generatedAt: z.string(),
  record: z.unknown(),
  warnings: z.array(publicWarningSchema).optional(),
});

const adapterCapabilitiesSchema = z.object({
  discovery: z.enum(["full", "partial", "none", "experimental"]),
  transcript: z.enum(["full", "partial", "none", "experimental"]),
  toolCalls: z.enum(["full", "partial", "none", "experimental"]),
  usage: z.enum(["full", "partial", "none", "experimental"]),
  model: z.enum(["full", "partial", "none", "experimental"]),
  reasoning: z.enum(["full", "partial", "none", "experimental"]),
  notes: z.array(z.string()).optional(),
});

export const doctorEnvelopeSchema = z.object({
  format: z.literal("logsesh.doctor.v1"),
  generatedAt: z.string(),
  tools: z.array(
    z.object({
      tool: toolNameSchema,
      detected: z.boolean(),
      root: z.string(),
      rootAccessible: z.boolean(),
      candidateFiles: z.number(),
      candidateFilesCapped: z.boolean().optional(),
      adapterVersion: z.string(),
      capabilities: adapterCapabilitiesSchema,
      permissionIssue: z.string().optional(),
    }),
  ),
  pricing: z.object({
    version: z.string(),
    asOf: z.string(),
    sourceUrl: z.string(),
    sources: z.array(
      z.object({
        provider: z.string(),
        url: z.string(),
        asOf: z.string(),
      }),
    ),
    modelCount: z.number(),
  }),
  exportDefaults: z.object({
    transcriptRedactDefault: z.boolean(),
    summaryCsvRedactRequired: z.boolean(),
    anonymizePathsDefault: z.boolean(),
  }),
  warnings: z.array(publicWarningSchema).optional(),
});

export function generatedAt(): string {
  return new Date().toISOString();
}
