import { CodexModelTracker, looksLikeModelId } from "../model-resolution.js";
import { ParseContext } from "../parse-context.js";
import { detectRootAccess, walkFiles } from "../fs-walk.js";
import type {
  Adapter,
  DiscoverOptions,
  ParseOptions,
  Session,
  SessionFile,
  ToolName,
  Usage,
} from "../types.js";
import { sessionFileNameId } from "../util.js";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  codexFunctionCallOutputPayloadSchema,
  codexFunctionCallPayloadSchema,
  codexLineSchema,
  codexMessagePayloadSchema,
  codexSessionMetaPayloadSchema,
  codexTokenCountPayloadSchema,
  codexTurnContextPayloadSchema,
  codexWebSearchPayloadSchema,
  parseCodexPayload,
  requireCallId,
} from "./codex-schemas.js";

import { ADAPTER_VERSIONS, DEFAULT_LOG_ROOT_SEGMENTS } from "../constants.js";

interface CodexTokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

function codexRoot(opts: DiscoverOptions): string {
  return opts.roots?.codex ?? join(homedir(), ...DEFAULT_LOG_ROOT_SEGMENTS.codex);
}

function mapCodexUsage(u: CodexTokenUsage): Usage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cached_input_tokens,
    reasoningTokens: u.reasoning_output_tokens,
    totalTokens: u.total_tokens,
  };
}

function codexModelFromMeta(meta: { model?: string; model_provider?: string }): string | undefined {
  if (meta.model && looksLikeModelId(meta.model)) return meta.model;
  if (meta.model_provider && looksLikeModelId(meta.model_provider)) return meta.model_provider;
  return undefined;
}

function messageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("text" in part)) return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function payloadType(payload: Record<string, unknown>): string | undefined {
  return typeof payload.type === "string" ? payload.type : undefined;
}

export const codexAdapter: Adapter = {
  tool: "codex" as ToolName,
  adapterVersion: ADAPTER_VERSIONS.codex,
  capabilities: {
    discovery: "full",
    transcript: "partial",
    toolCalls: "full",
    usage: "full",
    model: "partial",
    reasoning: "partial",
    notes: [
      "Developer and system messages are skipped.",
      "Encrypted reasoning blobs are not exported; summaries are captured when present.",
      "Model is resolved from session_meta and turn_context; bare provider names are ignored.",
    ],
  },

  async detect(): Promise<boolean> {
    const { accessible } = await detectRootAccess(codexRoot({}), "codex");
    return accessible;
  },

  async *discover(opts: DiscoverOptions): AsyncIterable<SessionFile> {
    const root = codexRoot(opts);
    for await (const path of walkFiles(root, (_full, name, isDirectory) =>
      isDirectory ? true : name.startsWith("rollout-") && name.endsWith(".jsonl"),
    )) {
      if (opts.since || opts.until) {
        const match = path.match(/\/sessions\/(\d{4})\/(\d{2})\/(\d{2})\//);
        if (match) {
          const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
          if (opts.since && fileDate < opts.since) continue;
          if (opts.until && fileDate > opts.until) continue;
        }
      }
      yield { path, tool: "codex" };
    }
  },

  async *parse(file: SessionFile, opts: ParseOptions): AsyncIterable<Session> {
    const ctx = new ParseContext({
      tool: "codex",
      adapterVersion: ADAPTER_VERSIONS.codex,
      file,
      opts,
      sessionId: sessionFileNameId(file.path),
    });
    const modelTracker = new CodexModelTracker();
    let sawTokenCount = false;
    let sawUsableTokenCount = false;
    let stepCounter = 0;

    for await (const rec of ctx.records()) {
      const env = ctx.decode(rec, codexLineSchema, "Codex envelope");
      if (!env) continue;
      if (typeof env.ordinal === "number") ctx.observeSequence(env.ordinal);

      const payload = env.payload;
      if (env.type === "session_meta") {
        const meta = parseCodexPayload(codexSessionMetaPayloadSchema, payload);
        if (!meta) continue;
        if (meta.id) ctx.setSessionId(meta.id);
        if (meta.cwd) ctx.setProjectPath(meta.cwd);
        modelTracker.observe(codexModelFromMeta(meta));
        continue;
      }

      if (env.type === "turn_context") {
        const turn = parseCodexPayload(codexTurnContextPayloadSchema, payload);
        if (turn?.model) modelTracker.observe(turn.model);
        continue;
      }

      if (env.type === "event_msg") {
        const tokenEvent = parseCodexPayload(codexTokenCountPayloadSchema, payload);
        if (!tokenEvent) continue;
        sawTokenCount = true;
        const total = tokenEvent.info?.total_token_usage;
        if (total) {
          sawUsableTokenCount = true;
          ctx.observeUsage({ mode: "cumulative", usage: mapCodexUsage(total) });
        }
        continue;
      }

      if (env.type !== "response_item") {
        ctx.unknownRecord(env.type);
        continue;
      }

      if (!payload) continue;
      const kind = payloadType(payload);

      const message = parseCodexPayload(codexMessagePayloadSchema, payload);
      if (message) {
        if (message.role === "developer" || message.role === "system") {
          ctx.addWarning({
            code: "skipped_role",
            message: `Skipped ${message.role} message`,
            severity: "info",
            scope: "parse",
            sourcePath: file.path,
            line: rec.line ?? rec.seq,
          });
          continue;
        }
        if (message.role !== "user" && message.role !== "assistant") continue;

        const text = messageText(message.content);
        if (!text) continue;

        stepCounter++;
        ctx.addRecord({
          role: message.role,
          fragmentGroupId: `${message.role}-step-${stepCounter}`,
          sourceLine: rec.seq,
          blocks: [{ kind: "text", text }],
          timestamp: env.timestamp,
        });
        continue;
      }

      if (kind === "reasoning") {
        if (payload.encrypted_content) {
          ctx.addWarning({
            code: "dropped_encrypted_reasoning",
            message: "Dropped encrypted reasoning blob",
            severity: "info",
            scope: "parse",
            sourcePath: file.path,
            line: rec.line ?? rec.seq,
          });
        }
        const summary =
          typeof payload.summary === "string" ? payload.summary : messageText(payload.content);
        if (summary) {
          stepCounter++;
          ctx.addRecord({
            role: "assistant",
            fragmentGroupId: `reasoning-${stepCounter}`,
            sourceLine: rec.seq,
            blocks: [{ kind: "thinking", text: summary }],
            timestamp: env.timestamp,
          });
        }
        continue;
      }

      const functionCall = parseCodexPayload(codexFunctionCallPayloadSchema, payload);
      if (functionCall) {
        const callId = requireCallId(functionCall.call_id ?? functionCall.id);
        if (!callId) continue;
        stepCounter++;
        ctx.addRecord({
          role: "assistant",
          fragmentGroupId: `call-${callId}`,
          sourceLine: rec.seq,
          blocks: [
            {
              kind: "tool_use",
              id: callId,
              name: typeof functionCall.name === "string" ? functionCall.name : "unknown",
              input: functionCall.arguments ?? functionCall.input,
            },
          ],
          timestamp: env.timestamp,
        });
        continue;
      }

      const functionOutput = parseCodexPayload(codexFunctionCallOutputPayloadSchema, payload);
      if (functionOutput) {
        ctx.addToolResult({
          toolUseId: functionOutput.call_id,
          sourceLine: rec.seq,
          output: functionOutput.output,
          status: functionOutput.is_error ? "error" : "success",
        });
        continue;
      }

      const webSearch = parseCodexPayload(codexWebSearchPayloadSchema, payload);
      if (webSearch) {
        const callId = requireCallId(webSearch.call_id, `web-${rec.seq}`);
        if (!callId) continue;
        stepCounter++;
        ctx.addRecord({
          role: "assistant",
          fragmentGroupId: `call-${callId}`,
          sourceLine: rec.seq,
          blocks: [
            {
              kind: "tool_use",
              id: callId,
              name: "web_search",
              input: payload,
            },
          ],
          timestamp: env.timestamp,
        });
        continue;
      }

      if (
        kind === "function_call" ||
        kind === "custom_tool_call" ||
        kind === "function_call_output" ||
        kind === "custom_tool_call_output" ||
        kind === "web_search_call" ||
        kind === "message"
      ) {
        continue;
      }

      ctx.unknownRecord(kind ?? "response_item");
    }

    if (sawTokenCount && !sawUsableTokenCount) {
      ctx.addWarning({
        code: "missing_token_usage",
        message: "No usable token_count events found",
        severity: "warn",
        scope: "parse",
        sourcePath: file.path,
      });
    }

    ctx.setModel(modelTracker.resolve());
    yield ctx.finish();
  },
};
