import { CodexModelTracker, looksLikeModelId } from "../model-resolution.js";
import { ParseContext, scanSource } from "../parse-context.js";
import { SessionBuilder } from "../session-builder.js";
import { detectRootAccess, walkFiles } from "../fs-walk.js";
import type {
  Adapter,
  DiscoverOptions,
  ParseOptions,
  Session,
  SessionFile,
  ToolName,
} from "../types.js";
import {
  extractCodexSessionDate,
  isCodexArchivedPath,
  parseJsonLine,
  sessionFileNameId,
} from "../util.js";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ADAPTER_VERSIONS,
  CODEX_ARCHIVE_ROOT_SEGMENTS,
  CODEX_IGNORED_LINE_TYPES,
  CODEX_IGNORED_PAYLOAD_TYPES,
  DEFAULT_LOG_ROOT_SEGMENTS,
} from "../constants.js";
import { dispatchCodexPayload, lineageFromCodexMeta, mapCodexUsage } from "./codex-events.js";
import {
  codexLineSchema,
  codexSessionMetaPayloadSchema,
  codexTokenCountPayloadSchema,
  codexTokenUsageRecordPayloadSchema,
  codexTurnContextPayloadSchema,
  parseCodexPayload,
} from "./codex-schemas.js";

function codexRoot(opts: DiscoverOptions): string {
  return opts.roots?.codex ?? join(homedir(), ...DEFAULT_LOG_ROOT_SEGMENTS.codex);
}

function codexArchiveRoot(opts: DiscoverOptions): string | undefined {
  if (opts.roots?.codex) return undefined;
  return join(homedir(), ...CODEX_ARCHIVE_ROOT_SEGMENTS);
}

function codexModelFromMeta(meta: { model?: string; model_provider?: string }): string | undefined {
  if (meta.model && looksLikeModelId(meta.model)) return meta.model;
  if (meta.model_provider && looksLikeModelId(meta.model_provider)) return meta.model_provider;
  return undefined;
}

async function* walkCodexRoot(root: string, opts: DiscoverOptions): AsyncIterable<string> {
  for await (const path of walkFiles(root, (_full, name, isDirectory) =>
    isDirectory ? true : name.startsWith("rollout-") && name.endsWith(".jsonl"),
  )) {
    if (opts.since || opts.until) {
      const fileDate = extractCodexSessionDate(path);
      if (fileDate) {
        if (opts.since && fileDate < opts.since) continue;
        if (opts.until && fileDate > opts.until) continue;
      }
    }
    yield path;
  }
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
      "Active ~/.codex/sessions and archived_sessions are both discovered. Codex's own SQLite is not read.",
    ],
  },

  async detect(): Promise<boolean> {
    const { accessible } = await detectRootAccess(codexRoot({}), "codex");
    if (accessible) return true;
    const archive = codexArchiveRoot({});
    if (!archive) return false;
    const archived = await detectRootAccess(archive, "codex");
    return archived.accessible;
  },

  async *discover(opts: DiscoverOptions): AsyncIterable<SessionFile> {
    const seen = new Set<string>();
    for await (const path of walkCodexRoot(codexRoot(opts), opts)) {
      seen.add(path);
      yield { path, tool: "codex" };
    }
    const archive = codexArchiveRoot(opts);
    if (!archive) return;
    for await (const path of walkCodexRoot(archive, opts)) {
      if (seen.has(path)) continue;
      yield { path, tool: "codex" };
    }
  },

  async *parse(file: SessionFile, opts: ParseOptions): AsyncIterable<Session> {
    let sessionId = sessionFileNameId(file.path);
    const builder = new SessionBuilder({
      tool: "codex",
      adapterVersion: ADAPTER_VERSIONS.codex,
      sourcePath: file.path,
      sessionId,
      maxTurnChars: opts.maxTurnChars,
      maxToolOutputChars: opts.maxToolOutputChars,
    });
    builder.setSourceLifecycle(isCodexArchivedPath(file.path) ? "archived" : "active");

    const ctx = new ParseContext({ tool: "codex", sourcePath: file.path, sessionId });
    const modelTracker = new CodexModelTracker();
    let sawTokenCount = false;
    let sawUsableTokenCount = false;
    let stepCounter = 0;
    const seenOrdinals = new Set<number>();
    let lastOrdinal: number | undefined;

    await scanSource(file.path, ctx, opts, (line, lineNumber) => {
      const parsed = parseJsonLine(line, lineNumber, file.path);
      if (!parsed.ok) {
        ctx.malformed(parsed.error, lineNumber);
        return;
      }

      const lineParsed = codexLineSchema.safeParse(parsed.value);
      if (!lineParsed.success) {
        ctx.malformed(`Line ${lineNumber}: invalid Codex record shape`, lineNumber);
        return;
      }

      const record = lineParsed.data;
      if (typeof record.ordinal === "number") {
        if (seenOrdinals.has(record.ordinal)) {
          builder.addWarning({
            code: "duplicate_event_ordinal",
            message: `codex: duplicate event ordinal ${record.ordinal}; source order preserved`,
            severity: "info",
            scope: "parse",
            sourcePath: file.path,
            sessionId,
            line: lineNumber,
          });
        } else if (lastOrdinal !== undefined && record.ordinal > lastOrdinal + 1) {
          builder.addWarning({
            code: "duplicate_event_ordinal",
            message: `codex: ordinal gap ${lastOrdinal} -> ${record.ordinal}; source order preserved`,
            severity: "info",
            scope: "parse",
            sourcePath: file.path,
            sessionId,
            line: lineNumber,
          });
        }
        seenOrdinals.add(record.ordinal);
        lastOrdinal = record.ordinal;
      }

      const lineType = record.type;
      const payload = record.payload;

      if (CODEX_IGNORED_LINE_TYPES.has(lineType)) {
        ctx.ignoredKnown(lineType);
        return;
      }

      if (lineType === "session_meta") {
        ctx.recognized(lineType);
        const meta = parseCodexPayload(codexSessionMetaPayloadSchema, payload);
        if (!meta) return;
        if (meta.id) {
          sessionId = meta.id;
          builder.setSessionId(sessionId);
          ctx.setSessionId(sessionId);
        }
        if (meta.cwd) builder.setProjectPath(meta.cwd);
        modelTracker.observe(codexModelFromMeta(meta));
        const lineage = lineageFromCodexMeta(meta);
        if (lineage) builder.setLineage(lineage);
        return;
      }

      if (lineType === "turn_context") {
        ctx.recognized(lineType);
        const turn = parseCodexPayload(codexTurnContextPayloadSchema, payload);
        if (turn?.model) modelTracker.observe(turn.model);
        return;
      }

      if (lineType === "token_usage_record") {
        ctx.recognized(lineType);
        sawTokenCount = true;
        const usagePayload = parseCodexPayload(codexTokenUsageRecordPayloadSchema, payload);
        const usage = usagePayload?.usage ?? usagePayload;
        if (usage && (usage.total_tokens !== undefined || usage.input_tokens !== undefined)) {
          sawUsableTokenCount = true;
          builder.observeUsage({ mode: "cumulative", usage: mapCodexUsage(usage) });
        }
        return;
      }

      if (lineType === "event_msg") {
        const tokenEvent = parseCodexPayload(codexTokenCountPayloadSchema, payload);
        if (tokenEvent) {
          ctx.recognized(lineType);
          sawTokenCount = true;
          const total = tokenEvent.info?.total_token_usage;
          if (total) {
            sawUsableTokenCount = true;
            builder.observeUsage({ mode: "cumulative", usage: mapCodexUsage(total) });
          }
          return;
        }
        const payloadType = typeof payload?.type === "string" ? payload.type : undefined;
        if (payloadType && CODEX_IGNORED_PAYLOAD_TYPES.has(payloadType)) {
          ctx.ignoredKnown(payloadType);
          return;
        }
        if (payloadType) ctx.unknown(payloadType);
        else ctx.ignoredKnown(lineType);
        return;
      }

      if (lineType !== "response_item") {
        ctx.unknown(lineType);
        return;
      }

      const dispatched = dispatchCodexPayload(payload, lineNumber);
      switch (dispatched.kind) {
        case "skip":
          ctx.ignoredKnown(lineType);
          return;
        case "ignored":
          ctx.ignoredKnown(dispatched.type);
          return;
        case "unknown":
          ctx.unknown(dispatched.type);
          return;
        case "skipped_role":
          ctx.recognized("message");
          builder.addWarning({
            code: "skipped_role",
            message: `Skipped ${dispatched.role} message`,
            severity: "info",
            scope: "parse",
            sourcePath: file.path,
            sessionId,
            line: lineNumber,
          });
          return;
        case "message":
          ctx.recognized("message");
          stepCounter++;
          builder.addRecord({
            role: dispatched.role,
            fragmentGroupId: `${dispatched.role}-step-${stepCounter}`,
            sourceLine: lineNumber,
            blocks: [{ kind: "text", text: dispatched.text }],
            timestamp: record.timestamp,
          });
          return;
        case "reasoning":
          ctx.recognized("reasoning");
          if (dispatched.encrypted) {
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
          if (dispatched.summary) {
            stepCounter++;
            builder.addRecord({
              role: "assistant",
              fragmentGroupId: `reasoning-${stepCounter}`,
              sourceLine: lineNumber,
              blocks: [{ kind: "thinking", text: dispatched.summary }],
              timestamp: record.timestamp,
            });
          }
          return;
        case "tool_call":
          ctx.recognized("function_call");
          stepCounter++;
          builder.addRecord({
            role: "assistant",
            fragmentGroupId: `call-${dispatched.id}`,
            sourceLine: lineNumber,
            blocks: [
              {
                kind: "tool_use",
                id: dispatched.id,
                name: dispatched.name,
                input: dispatched.input,
              },
            ],
            timestamp: record.timestamp,
          });
          return;
        case "tool_result":
          ctx.recognized("function_call_output");
          builder.addToolResult({
            toolUseId: dispatched.id,
            sourceLine: lineNumber,
            output: dispatched.output,
            status: dispatched.error ? "error" : "success",
          });
          return;
      }
    });

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

    builder.setModel(modelTracker.resolve());
    for (const warning of ctx.drainWarnings()) builder.addWarning(warning);
    builder.setFidelity(ctx.finalize());
    yield builder.finalize();
  },
};

export function getCodexArchiveRoot(opts: DiscoverOptions = {}): string | undefined {
  return codexArchiveRoot(opts);
}
