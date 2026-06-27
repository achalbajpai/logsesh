import { z } from "zod";

const tokenUsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cached_input_tokens: z.number().optional(),
  reasoning_output_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
});

export const codexLineSchema = z.object({
  type: z.string(),
  timestamp: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const codexSessionMetaPayloadSchema = z.object({
  id: z.string().optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  model_provider: z.string().optional(),
});

export const codexTokenCountPayloadSchema = z.object({
  type: z.literal("token_count"),
  info: z
    .object({
      total_token_usage: tokenUsageSchema.optional(),
    })
    .nullable()
    .optional(),
});

export const codexMessagePayloadSchema = z.object({
  type: z.literal("message"),
  role: z.string(),
  content: z.unknown().optional(),
});

export const codexFunctionCallPayloadSchema = z
  .object({
    type: z.enum(["function_call", "custom_tool_call"]),
    call_id: z.string().optional(),
    id: z.string().optional(),
    name: z.unknown().optional(),
    arguments: z.unknown().optional(),
    input: z.unknown().optional(),
  })
  .refine((data) => typeof (data.call_id ?? data.id) === "string", {
    message: "function_call missing string call_id",
  });

export const codexFunctionCallOutputPayloadSchema = z.object({
  type: z.enum(["function_call_output", "custom_tool_call_output"]),
  call_id: z.string(),
  output: z.unknown().optional(),
  is_error: z.boolean().optional(),
});

export const codexWebSearchPayloadSchema = z.object({
  type: z.literal("web_search_call"),
  call_id: z.string().optional(),
});

export function parseCodexPayload<T extends z.ZodTypeAny>(
  schema: T,
  payload: Record<string, unknown> | undefined,
): z.infer<T> | undefined {
  if (!payload) return undefined;
  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

export function requireCallId(callId: string | undefined, fallback?: string): string | undefined {
  if (typeof callId === "string" && callId.length > 0) return callId;
  return fallback;
}
