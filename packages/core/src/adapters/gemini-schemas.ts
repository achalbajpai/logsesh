import { z } from "zod";

export const geminiRewindSchema = z.object({
  $rewindTo: z.string(),
});

export const geminiSetSchema = z.object({
  $set: z.record(z.string(), z.unknown()),
});

export const geminiHeaderSchema = z
  .object({
    sessionId: z.string(),
    projectHash: z.string().optional(),
    startTime: z.string().optional(),
    lastUpdated: z.string().optional(),
    kind: z.enum(["main", "subagent"]).optional(),
    messages: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const geminiMessageSchema = z
  .object({
    id: z.string().optional(),
    timestamp: z.string().optional(),
    content: z.unknown().optional(),
    type: z.string(),
    toolCalls: z.array(z.unknown()).optional(),
    thoughts: z.unknown().optional(),
    tokens: z.unknown().optional(),
    model: z.string().optional(),
  })
  .passthrough();

export const geminiLegacySchema = z
  .object({
    role: z.string().optional(),
    timestamp: z.string().optional(),
    model: z.string().optional(),
    modelVersion: z.string().optional(),
    parts: z.array(z.unknown()).optional(),
    usageMetadata: z
      .object({
        promptTokenCount: z.number().optional(),
        candidatesTokenCount: z.number().optional(),
        totalTokenCount: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export const geminiToolCallSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    args: z.unknown().optional(),
    result: z.unknown().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export const geminiTokensSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cached: z.number().optional(),
    thoughts: z.number().optional(),
    tool: z.number().optional(),
    total: z.number().optional(),
  })
  .passthrough();

export type GeminiEvent =
  | { kind: "header"; value: z.infer<typeof geminiHeaderSchema> }
  | { kind: "set"; value: Record<string, unknown> }
  | { kind: "rewind"; messageId: string }
  | { kind: "message"; value: z.infer<typeof geminiMessageSchema> }
  | { kind: "legacy"; value: z.infer<typeof geminiLegacySchema> }
  | { kind: "unknown"; type?: string };

export function classifyGeminiRecord(value: unknown): GeminiEvent {
  if (!value || typeof value !== "object") return { kind: "unknown" };
  const rewind = geminiRewindSchema.safeParse(value);
  if (rewind.success) return { kind: "rewind", messageId: rewind.data.$rewindTo };
  const set = geminiSetSchema.safeParse(value);
  if (set.success) return { kind: "set", value: set.data.$set };
  const asRecord = value as Record<string, unknown>;
  if (typeof asRecord.type === "string") {
    const message = geminiMessageSchema.safeParse(value);
    if (message.success) return { kind: "message", value: message.data };
    return { kind: "unknown", type: asRecord.type };
  }
  if (typeof asRecord.role === "string" && ("parts" in asRecord || "content" in asRecord)) {
    const legacy = geminiLegacySchema.safeParse(value);
    if (legacy.success) return { kind: "legacy", value: legacy.data };
  }
  if (typeof asRecord.sessionId === "string" && !("type" in asRecord) && !("role" in asRecord)) {
    const header = geminiHeaderSchema.safeParse(value);
    if (header.success) return { kind: "header", value: header.data };
  }
  return { kind: "unknown", type: typeof asRecord.type === "string" ? asRecord.type : undefined };
}
