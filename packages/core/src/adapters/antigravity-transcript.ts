import { z } from "zod";
import type { ParseOptions } from "../types.js";
import { type ParseContext, scanSource } from "../parse-context.js";
import { parseJsonLine } from "../util.js";
import {
  ANTIGRAVITY_JSONL_ASSISTANT_TYPES,
  ANTIGRAVITY_JSONL_IGNORED_TYPES,
  ANTIGRAVITY_JSONL_TOOL_RESULT_TYPES,
  ANTIGRAVITY_JSONL_USER_TYPES,
  type AntigravityEvent,
  type AntigravityToolCall,
  modelFromAntigravityText,
  unwrapAntigravityUserText,
} from "./antigravity-events.js";

const transcriptRecordSchema = z
  .object({
    step_index: z.number().optional(),
    source: z.string().optional(),
    type: z.string().optional(),
    status: z.string().optional(),
    created_at: z.union([z.string(), z.number()]).optional(),
    content: z.string().optional(),
    thinking: z.string().optional(),
    tool_calls: z.array(z.unknown()).optional(),
    truncated_fields: z.array(z.string()).optional(),
  })
  .passthrough();

const toolCallSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    args: z.unknown().optional(),
    arguments: z.unknown().optional(),
  })
  .passthrough();

function createdAtIso(value: string | number | undefined): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseToolCalls(raw: unknown[] | undefined, stepIndex: number): AntigravityToolCall[] {
  if (!raw) return [];
  const calls: AntigravityToolCall[] = [];
  let i = 0;
  for (const item of raw) {
    const parsed = toolCallSchema.safeParse(item);
    if (!parsed.success) continue;
    const name = parsed.data.name;
    if (!name) continue;
    i += 1;
    calls.push({
      id: parsed.data.id ?? `step-${stepIndex}-tool-${i}`,
      name,
      input: parsed.data.args ?? parsed.data.arguments,
    });
  }
  return calls;
}

export async function parseAntigravityTranscript(
  path: string,
  ctx: ParseContext,
  opts: ParseOptions,
): Promise<{ events: AntigravityEvent[]; truncated: boolean }> {
  const events: AntigravityEvent[] = [];
  let truncated = false;
  const pendingIds: string[] = [];

  await scanSource(path, ctx, opts, (line, lineNumber) => {
    const parsed = parseJsonLine(line, lineNumber, path);
    if (!parsed.ok) {
      ctx.malformed(parsed.error, lineNumber);
      events.push({ kind: "malformed", line: lineNumber, message: parsed.error });
      return;
    }
    const record = transcriptRecordSchema.safeParse(parsed.value);
    if (!record.success) {
      ctx.unknown("invalid");
      events.push({ kind: "unknown", line: lineNumber, type: "invalid" });
      return;
    }
    const type = record.data.type ?? "missing";
    if (!("step_index" in record.data) && !record.data.type) {
      ctx.unknown("invalid");
      events.push({ kind: "unknown", line: lineNumber, type: "invalid" });
      return;
    }
    if (record.data.truncated_fields && record.data.truncated_fields.length > 0) {
      truncated = true;
    }
    const timestamp = createdAtIso(record.data.created_at);
    const stepIndex = record.data.step_index ?? lineNumber;

    if (ANTIGRAVITY_JSONL_USER_TYPES.has(type)) {
      const text = unwrapAntigravityUserText(record.data.content ?? "");
      if (!text) {
        ctx.ignoredKnown(type);
        events.push({ kind: "ignored", line: lineNumber, type });
        return;
      }
      ctx.recognized(type);
      events.push({
        kind: "user",
        line: lineNumber,
        text,
        timestamp,
        modelHint: modelFromAntigravityText(record.data.content ?? ""),
      });
      return;
    }

    if (ANTIGRAVITY_JSONL_ASSISTANT_TYPES.has(type)) {
      const toolCalls = parseToolCalls(record.data.tool_calls, stepIndex);
      const text = record.data.content?.trim();
      const thinking = record.data.thinking?.trim();
      if (!text && !thinking && toolCalls.length === 0) {
        ctx.ignoredKnown(type);
        events.push({ kind: "ignored", line: lineNumber, type });
        return;
      }
      for (const call of toolCalls) pendingIds.push(call.id);
      ctx.recognized(type);
      events.push({
        kind: "assistant",
        line: lineNumber,
        text,
        thinking,
        timestamp,
        toolCalls,
      });
      return;
    }

    if (ANTIGRAVITY_JSONL_IGNORED_TYPES.has(type)) {
      ctx.ignoredKnown(type);
      events.push({ kind: "ignored", line: lineNumber, type });
      return;
    }

    if (ANTIGRAVITY_JSONL_TOOL_RESULT_TYPES.has(type)) {
      const toolUseId = pendingIds.shift();
      ctx.recognized(type);
      events.push({
        kind: "tool_result",
        line: lineNumber,
        toolUseId,
        output: record.data.content ?? "",
        status: record.data.status === "ERROR" ? "error" : "success",
        timestamp,
      });
      return;
    }

    ctx.unknown(type);
    events.push({ kind: "unknown", line: lineNumber, type });
  });

  return { events, truncated };
}
