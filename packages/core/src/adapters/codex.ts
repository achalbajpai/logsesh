import { CodexModelTracker, looksLikeModelId } from "../model-resolution.js";
import { SessionBuilder } from "../session-builder.js";
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
import { parseJsonLine, readJsonlLines, sessionFileNameId } from "../util.js";
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
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
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
    let sessionId = sessionFileNameId(file.path);
    let projectPath: string | undefined;
    const modelTracker = new CodexModelTracker();
    let lastTokenUsage: Usage | undefined;
    let sawTokenCount = false;
    let sawUsableTokenCount = false;
    let stepCounter = 0;

    const builder = new SessionBuilder({
      tool: "codex",
      adapterVersion: ADAPTER_VERSIONS.codex,
      sourcePath: file.path,
      sessionId,
      maxTurnChars: opts.maxTurnChars,
      maxToolOutputChars: opts.maxToolOutputChars,
    });

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

        const lineParsed = codexLineSchema.safeParse(parsed.value);
        if (!lineParsed.success) {
          builder.addWarning({
            code: "invalid_line_shape",
            message: `Line ${lineNumber}: invalid Codex record shape`,
            severity: "warn",
            scope: "parse",
            sourcePath: file.path,
            sessionId,
            line: lineNumber,
          });
          return;
        }

        const record = lineParsed.data;
        const lineType = record.type;
        const payload = record.payload;
        if (!payload) return;

        if (lineType === "session_meta") {
          const meta = parseCodexPayload(codexSessionMetaPayloadSchema, payload);
          if (!meta) return;
          if (meta.id) sessionId = meta.id;
          if (meta.cwd) projectPath = meta.cwd;
          modelTracker.observe(codexModelFromMeta(meta));
          return;
        }

        if (lineType === "turn_context") {
          const ctx = parseCodexPayload(codexTurnContextPayloadSchema, payload);
          if (ctx?.model) modelTracker.observe(ctx.model);
          return;
        }

        if (lineType === "event_msg") {
          const tokenEvent = parseCodexPayload(codexTokenCountPayloadSchema, payload);
          if (!tokenEvent) return;
          sawTokenCount = true;
          const total = tokenEvent.info?.total_token_usage;
          if (total) {
            sawUsableTokenCount = true;
            lastTokenUsage = mapCodexUsage(total);
          }
          return;
        }

        if (lineType !== "response_item") return;

        const message = parseCodexPayload(codexMessagePayloadSchema, payload);
        if (message) {
          if (message.role === "developer" || message.role === "system") {
            builder.addWarning({
              code: "skipped_role",
              message: `Skipped ${message.role} message`,
              severity: "info",
              scope: "parse",
              sourcePath: file.path,
              sessionId,
              line: lineNumber,
            });
            return;
          }
          if (message.role !== "user" && message.role !== "assistant") return;

          const text = messageText(message.content);
          if (!text) return;

          stepCounter++;
          builder.addRecord({
            role: message.role,
            fragmentGroupId: `${message.role}-step-${stepCounter}`,
            sourceLine: lineNumber,
            blocks: [{ kind: "text", text }],
            timestamp: record.timestamp,
          });
          return;
        }

        if (payload.type === "reasoning") {
          if (payload.encrypted_content) {
            builder.addWarning({
              code: "dropped_encrypted_reasoning",
              message: "Dropped encrypted reasoning blob",
              severity: "info",
              scope: "parse",
              sourcePath: file.path,
              sessionId,
              line: lineNumber,
            });
          }
          const summary =
            typeof payload.summary === "string" ? payload.summary : messageText(payload.content);
          if (summary) {
            stepCounter++;
            builder.addRecord({
              role: "assistant",
              fragmentGroupId: `reasoning-${stepCounter}`,
              sourceLine: lineNumber,
              blocks: [{ kind: "thinking", text: summary }],
              timestamp: record.timestamp,
            });
          }
          return;
        }

        const functionCall = parseCodexPayload(codexFunctionCallPayloadSchema, payload);
        if (functionCall) {
          const callId = requireCallId(functionCall.call_id ?? functionCall.id);
          if (!callId) return;
          stepCounter++;
          builder.addRecord({
            role: "assistant",
            fragmentGroupId: `call-${callId}`,
            sourceLine: lineNumber,
            blocks: [
              {
                kind: "tool_use",
                id: callId,
                name: typeof functionCall.name === "string" ? functionCall.name : "unknown",
                input: functionCall.arguments ?? functionCall.input,
              },
            ],
            timestamp: record.timestamp,
          });
          return;
        }

        const functionOutput = parseCodexPayload(codexFunctionCallOutputPayloadSchema, payload);
        if (functionOutput) {
          builder.addToolResult({
            toolUseId: functionOutput.call_id,
            sourceLine: lineNumber,
            output: functionOutput.output,
            status: functionOutput.is_error ? "error" : "success",
          });
          return;
        }

        const webSearch = parseCodexPayload(codexWebSearchPayloadSchema, payload);
        if (webSearch) {
          const callId = requireCallId(webSearch.call_id, `web-${lineNumber}`);
          if (!callId) return;
          stepCounter++;
          builder.addRecord({
            role: "assistant",
            fragmentGroupId: `call-${callId}`,
            sourceLine: lineNumber,
            blocks: [
              {
                kind: "tool_use",
                id: callId,
                name: "web_search",
                input: payload,
              },
            ],
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

    if (sawTokenCount && !sawUsableTokenCount) {
      builder.addWarning({
        code: "missing_token_usage",
        message: "No usable token_count events found",
        severity: "warn",
        scope: "parse",
        sourcePath: file.path,
        sessionId,
      });
    }

    const session = builder.finalize();
    session.id = sessionId;
    session.projectPath = projectPath;
    session.model = modelTracker.resolve();
    if (lastTokenUsage) session.usage = lastTokenUsage;
    yield session;
  },
};
