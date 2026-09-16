import { stat } from "node:fs/promises";
import {
  pbAllBytes,
  pbBytes,
  pbEncode,
  pbFields,
  pbLongestUtf8,
  pbStr,
  pbTimestampIso,
  pbUtf8,
  pbVarint,
} from "../protobuf-wire.js";
import type { Usage } from "../types.js";
import {
  ANTIGRAVITY_IGNORED_STEP_TYPES,
  ANTIGRAVITY_PAYLOAD_FIELD,
  ANTIGRAVITY_STATUS_CANCELED,
  ANTIGRAVITY_STATUS_DONE,
  ANTIGRAVITY_STATUS_ERROR,
  ANTIGRAVITY_STEP_PLANNER_RESPONSE,
  ANTIGRAVITY_STEP_USER_INPUT,
  type AntigravityEvent,
  type AntigravityToolCall,
  antigravityStepName,
  modelFromAntigravityText,
  modelFromProtobufStrings,
  unwrapAntigravityUserText,
} from "./antigravity-events.js";

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export interface AntigravitySqliteParse {
  events: AntigravityEvent[];
  model?: string;
  skipped: boolean;
  size: number;
  error?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asBuffer(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  return new Uint8Array();
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseJsonArg(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function usageFromMeta(meta: Uint8Array): Usage | undefined {
  const blob = pbBytes(meta, 9);
  if (!blob) return undefined;
  const inputTokens = pbVarint(blob, 2);
  const outputTokens = pbVarint(blob, 3);
  const cacheWrite = pbVarint(blob, 4);
  const cacheRead = pbVarint(blob, 5);
  if (!inputTokens && !outputTokens && !cacheRead && !cacheWrite) return undefined;
  const usage: Usage = {};
  if (inputTokens) usage.inputTokens = inputTokens;
  if (outputTokens) usage.outputTokens = outputTokens;
  if (cacheRead) usage.cacheReadTokens = cacheRead;
  if (cacheWrite) usage.cacheWriteTokens = cacheWrite;
  usage.totalTokens =
    (inputTokens ?? 0) + (outputTokens ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
  return usage;
}

function toolCallsFromPlanner(planner: Uint8Array): AntigravityToolCall[] {
  const calls: AntigravityToolCall[] = [];
  for (const raw of pbAllBytes(planner, 7)) {
    const id = pbStr(raw, 1);
    const name = pbStr(raw, 2) ?? pbStr(raw, 9);
    if (!id || !name) continue;
    calls.push({
      id,
      name,
      input: parseJsonArg(pbStr(raw, 3)),
    });
  }
  return calls;
}

function toolUseIdFromMeta(meta: Uint8Array): string | undefined {
  const call = pbBytes(meta, 4);
  return call ? pbStr(call, 1) : undefined;
}

function toolOutput(stepType: number, payload: Uint8Array, errorDetails: Uint8Array): unknown {
  const error = pbStr(errorDetails, 9) ?? pbStr(errorDetails, 1) ?? pbStr(errorDetails, 2);
  if (error?.trim()) return error.trim();

  const field = ANTIGRAVITY_PAYLOAD_FIELD[stepType];
  const body = field !== undefined ? (pbBytes(payload, field) ?? new Uint8Array()) : payload;

  if (stepType === 8 || stepType === 103) {
    return pbStr(body, 4) ?? pbStr(body, 9) ?? pbLongestUtf8(body, 1) ?? "";
  }
  if (stepType === 21) {
    const combined = pbBytes(body, 21);
    return (
      (combined ? pbStr(combined, 1) : undefined) ?? pbStr(body, 4) ?? pbLongestUtf8(body, 1) ?? ""
    );
  }
  if (stepType === 9) {
    const path = pbStr(body, 1) ?? "";
    const entries = pbAllBytes(body, 3).map((entry) => ({
      name: pbStr(entry, 1) ?? "",
      isDir: pbVarint(entry, 2) === 1,
      sizeBytes: pbVarint(entry, 4),
    }));
    return { path, entries };
  }
  if (stepType === 7) {
    return pbStr(body, 5) ?? pbStr(body, 3) ?? pbLongestUtf8(body, 1) ?? "";
  }
  if (stepType === 38) {
    return pbStr(body, 3) ?? pbLongestUtf8(body, 1) ?? "";
  }
  if (stepType === 132) {
    const result = pbBytes(body, 2);
    return (result ? pbStr(result, 1) : undefined) ?? pbLongestUtf8(body, 1) ?? "";
  }
  return pbLongestUtf8(body, 1) ?? pbLongestUtf8(payload, 16) ?? "";
}

function protobufStrings(buf: Uint8Array): string[] {
  const out: string[] = [];
  for (const entry of pbFields(buf)) {
    if (entry.value.wire !== 2) continue;
    const text = pbUtf8(entry.value.value);
    if (text && text.length >= 6) out.push(text);
    out.push(...protobufStrings(entry.value.value));
  }
  return out;
}

function userText(payload: Uint8Array): { text: string; modelHint?: string } {
  const input = pbBytes(payload, 19);
  if (!input) return { text: "" };
  const direct = pbStr(input, 2)?.trim() || pbStr(input, 1)?.trim();
  const raw =
    direct ??
    pbAllBytes(input, 3)
      .map((item) => pbStr(item, 1)?.trim())
      .find((text) => Boolean(text));
  if (!raw) return { text: "" };
  return {
    text: unwrapAntigravityUserText(raw),
    modelHint: modelFromAntigravityText(raw),
  };
}

async function openReadonlySqlite(path: string): Promise<SqliteDatabase | undefined> {
  try {
    const mod = await import("node:sqlite");
    return new mod.DatabaseSync(path, { readOnly: true });
  } catch {
    return undefined;
  }
}

export async function parseAntigravitySqlite(
  path: string,
  opts: { maxFileBytes?: number } = {},
): Promise<AntigravitySqliteParse> {
  let size = 0;
  try {
    size = (await stat(path)).size;
  } catch (err) {
    return {
      events: [],
      skipped: false,
      size: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (opts.maxFileBytes !== undefined && size > opts.maxFileBytes) {
    return { events: [], skipped: true, size };
  }

  const db = await openReadonlySqlite(path);
  if (!db) {
    return { events: [], skipped: false, size, error: "node:sqlite is unavailable" };
  }

  try {
    const rows = db
      .prepare(
        "SELECT idx, step_type, status, metadata, error_details, step_payload FROM steps ORDER BY idx",
      )
      .all();
    const genRows = db.prepare("SELECT data FROM gen_metadata ORDER BY idx LIMIT 32").all();
    const model = modelFromProtobufStrings(
      genRows.flatMap((row) => {
        const rec = asRecord(row);
        return rec ? protobufStrings(asBuffer(rec.data)) : [];
      }),
    );

    const events: AntigravityEvent[] = [];
    for (const raw of rows) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const idx = asNumber(rec.idx);
      const stepType = asNumber(rec.step_type);
      const status = asNumber(rec.status);
      const metadata = asBuffer(rec.metadata);
      const errorDetails = asBuffer(rec.error_details);
      const payload = asBuffer(rec.step_payload);
      const timestamp = pbTimestampIso(payload) ?? pbTimestampIso(metadata);
      const line = idx + 1;
      const typeName = antigravityStepName(stepType);

      if (stepType === ANTIGRAVITY_STEP_USER_INPUT) {
        const user = userText(payload);
        if (!user.text) {
          events.push({ kind: "ignored", line, type: typeName });
          continue;
        }
        events.push({
          kind: "user",
          line,
          text: user.text,
          timestamp,
          modelHint: user.modelHint,
        });
        continue;
      }

      if (stepType === ANTIGRAVITY_STEP_PLANNER_RESPONSE) {
        const planner = pbBytes(payload, 20) ?? new Uint8Array();
        const text = (pbStr(planner, 1) ?? pbStr(planner, 8))?.trim();
        const thinking = pbStr(planner, 3)?.trim();
        const toolCalls = toolCallsFromPlanner(planner);
        if (!text && !thinking && toolCalls.length === 0) {
          events.push({ kind: "ignored", line, type: typeName });
          continue;
        }
        events.push({
          kind: "assistant",
          line,
          text,
          thinking,
          timestamp,
          usage: usageFromMeta(metadata),
          toolCalls,
        });
        continue;
      }

      if (ANTIGRAVITY_IGNORED_STEP_TYPES.has(stepType)) {
        events.push({ kind: "ignored", line, type: typeName });
        continue;
      }

      const done =
        status === ANTIGRAVITY_STATUS_DONE ||
        status === ANTIGRAVITY_STATUS_ERROR ||
        status === ANTIGRAVITY_STATUS_CANCELED;
      if (!done) {
        events.push({ kind: "ignored", line, type: `${typeName}_pending` });
        continue;
      }
      const toolUseId = toolUseIdFromMeta(metadata);
      if (!toolUseId && ANTIGRAVITY_PAYLOAD_FIELD[stepType] === undefined) {
        events.push({ kind: "unknown", line, type: typeName });
        continue;
      }

      events.push({
        kind: "tool_result",
        line,
        toolUseId,
        output: toolOutput(stepType, payload, errorDetails),
        status:
          status === ANTIGRAVITY_STATUS_ERROR || status === ANTIGRAVITY_STATUS_CANCELED
            ? "error"
            : "success",
        timestamp,
      });
    }

    return { events, model, skipped: false, size };
  } catch (err) {
    return {
      events: [],
      skipped: false,
      size,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    db.close();
  }
}

export function encodeAntigravityUserPayload(text: string, timestampSecs: number): Uint8Array {
  const ts = pbEncode([{ field: 1, varint: timestampSecs }]);
  const meta = pbEncode([{ field: 1, bytes: ts }]);
  const input = pbEncode([{ field: 2, bytes: text }]);
  return pbEncode([
    { field: 1, varint: ANTIGRAVITY_STEP_USER_INPUT },
    { field: 4, varint: ANTIGRAVITY_STATUS_DONE },
    { field: 5, bytes: meta },
    { field: 19, bytes: input },
  ]);
}

export function encodeAntigravityPlannerPayload(opts: {
  text?: string;
  thinking?: string;
  timestampSecs: number;
  toolCalls?: AntigravityToolCall[];
}): Uint8Array {
  const ts = pbEncode([{ field: 1, varint: opts.timestampSecs }]);
  const meta = pbEncode([{ field: 1, bytes: ts }]);
  return pbEncode([
    { field: 1, varint: ANTIGRAVITY_STEP_PLANNER_RESPONSE },
    { field: 4, varint: ANTIGRAVITY_STATUS_DONE },
    { field: 5, bytes: meta },
    { field: 20, bytes: encodePlannerBody(opts) },
  ]);
}

export function encodeAntigravityToolResult(opts: {
  stepType: number;
  toolUseId: string;
  output: string;
  timestampSecs: number;
}): { payload: Uint8Array; metadata: Uint8Array } {
  const ts = pbEncode([{ field: 1, varint: opts.timestampSecs }]);
  const call = pbEncode([{ field: 1, bytes: opts.toolUseId }]);
  const metadata = pbEncode([
    { field: 1, bytes: ts },
    { field: 4, bytes: call },
  ]);
  const field = ANTIGRAVITY_PAYLOAD_FIELD[opts.stepType] ?? 2;
  let body: Uint8Array;
  if (opts.stepType === 21) {
    body = pbEncode([{ field: 21, bytes: pbEncode([{ field: 1, bytes: opts.output }]) }]);
  } else if (opts.stepType === 8 || opts.stepType === 103) {
    body = pbEncode([{ field: 4, bytes: opts.output }]);
  } else if (opts.stepType === 9) {
    body = pbEncode([{ field: 3, bytes: pbEncode([{ field: 1, bytes: opts.output }]) }]);
  } else {
    body = pbEncode([{ field: 3, bytes: opts.output }]);
  }
  return {
    metadata,
    payload: pbEncode([
      { field: 1, varint: opts.stepType },
      { field: 4, varint: ANTIGRAVITY_STATUS_DONE },
      { field: 5, bytes: metadata },
      { field, bytes: body },
    ]),
  };
}

function encodePlannerBody(opts: {
  text?: string;
  thinking?: string;
  toolCalls?: AntigravityToolCall[];
}): Uint8Array {
  const fields: Array<{ field: number; bytes?: Uint8Array | string }> = [];
  if (opts.thinking) fields.push({ field: 3, bytes: opts.thinking });
  if (opts.text) fields.push({ field: 1, bytes: opts.text });
  for (const call of opts.toolCalls ?? []) {
    fields.push({
      field: 7,
      bytes: pbEncode([
        { field: 1, bytes: call.id },
        { field: 2, bytes: call.name },
        { field: 3, bytes: JSON.stringify(call.input ?? {}) },
      ]),
    });
  }
  return pbEncode(fields);
}
