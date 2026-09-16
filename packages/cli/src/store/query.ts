import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { PipelineOptions, Session, Turn, Warning } from "@logsesh/core";
import {
  SESSION_SCHEMA_VERSION,
  discoverFiles,
  getEnabledAdapters,
  matchesDateRange,
  matchesSessionFilters,
  matchesSessionTextQuery,
  parseQuery,
} from "@logsesh/core";
import { defaultIndexPath } from "./paths.js";
import {
  type SqliteDatabase,
  isSqliteCorruption,
  loadSqliteRuntime,
  openIndexDatabase,
} from "./sqlite.js";

export interface IndexedSessionResult {
  session: Session;
  warnings: Warning[];
}

function isWarningSeverity(value: unknown): value is Warning["severity"] {
  return value === "info" || value === "warn" || value === "error";
}

function isWarningScope(value: unknown): value is Warning["scope"] {
  return (
    value === "discovery" ||
    value === "parse" ||
    value === "export" ||
    value === "package" ||
    value === "pricing" ||
    value === "index"
  );
}

function asWarning(value: unknown): Warning | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (!("code" in value) || typeof value.code !== "string") return undefined;
  if (!("message" in value) || typeof value.message !== "string") return undefined;
  if (!("severity" in value) || !isWarningSeverity(value.severity)) return undefined;
  if (!("scope" in value) || !isWarningScope(value.scope)) return undefined;
  const warning: Warning = {
    code: value.code,
    message: value.message,
    severity: value.severity,
    scope: value.scope,
  };
  if ("sourcePath" in value && typeof value.sourcePath === "string") {
    warning.sourcePath = value.sourcePath;
  }
  if ("sessionId" in value && typeof value.sessionId === "string") {
    warning.sessionId = value.sessionId;
  }
  if ("line" in value && typeof value.line === "number" && Number.isFinite(value.line)) {
    warning.line = value.line;
  }
  if ("cause" in value && typeof value.cause === "string") warning.cause = value.cause;
  return warning;
}

function parseWarnings(raw: unknown): Warning[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const warnings: Warning[] = [];
    for (const item of parsed) {
      const warning = asWarning(item);
      if (warning) warnings.push(warning);
    }
    return warnings;
  } catch {
    return [];
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asTool(value: unknown): Session["tool"] | undefined {
  if (
    value === "claude-code" ||
    value === "codex" ||
    value === "antigravity" ||
    value === "gemini"
  ) {
    return value;
  }
  return undefined;
}

function sessionFromRow(
  row: Record<string, unknown>,
  turns: Turn[],
  sourcePath: string,
): Session | undefined {
  const tool = asTool(row.tool);
  if (!tool) return undefined;
  const usageRaw = asString(row.usage_json);
  let usage: Session["usage"];
  if (usageRaw) {
    try {
      usage = JSON.parse(usageRaw) as Session["usage"];
    } catch {
      usage = undefined;
    }
  }
  const lineage = {
    parentSessionId: asString(row.parent_session_id),
    agentId: asString(row.agent_id),
    agentType: asString(row.agent_type),
    originator: asString(row.originator),
    depth: asNumber(row.depth),
  };
  const hasLineage = Boolean(
    lineage.parentSessionId || lineage.agentId || lineage.agentType || lineage.originator,
  );
  const warnings = parseWarnings(row.warnings_json);

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: String(row.session_id),
    source: {
      tool,
      adapterVersion: "index",
      sourcePath,
      lifecycle: row.lifecycle === "archived" ? "archived" : "active",
    },
    tool,
    startedAt: asString(row.started_at),
    endedAt: asString(row.ended_at),
    projectPath: asString(row.project_path),
    model: asString(row.model),
    usage,
    costUsd: typeof row.cost_usd === "number" ? row.cost_usd : null,
    turns,
    lineage: hasLineage ? lineage : undefined,
    branch: asString(row.branch),
    ...(warnings.length > 0 ? { warnings } : {}),
    fidelity: {
      completeness:
        row.completeness === "partial" || row.completeness === "metadata-only"
          ? row.completeness
          : "complete",
    },
  };
}

function loadTurns(db: SqliteDatabase, sessionKey: string): Turn[] {
  const turnRows = db
    .prepare(
      "SELECT turn_index, role, timestamp, text_content FROM turns WHERE session_key = ? ORDER BY turn_index",
    )
    .all(sessionKey) as Array<{
    turn_index: number;
    role: Turn["role"];
    timestamp: string | null;
    text_content: string | null;
  }>;
  const callRows = db
    .prepare(
      "SELECT turn_index, call_id, name, status, input_text, output_text FROM tool_calls WHERE session_key = ?",
    )
    .all(sessionKey) as Array<{
    turn_index: number;
    call_id: string | null;
    name: string;
    status: string | null;
    input_text: string | null;
    output_text: string | null;
  }>;
  const callsByTurn = new Map<number, Turn["toolCalls"]>();
  for (const call of callRows) {
    const list = callsByTurn.get(call.turn_index) ?? [];
    list.push({
      id: call.call_id ?? `call-${call.turn_index}`,
      name: call.name,
      status: call.status === "error" || call.status === "success" ? call.status : undefined,
      input: call.input_text ? safeJson(call.input_text) : undefined,
      output: call.output_text ?? undefined,
    });
    callsByTurn.set(call.turn_index, list);
  }
  return turnRows.map((row) => ({
    id: `t-${row.turn_index}`,
    index: row.turn_index,
    timestamp: row.timestamp ?? undefined,
    role: row.role,
    content: row.text_content ? [{ kind: "text" as const, text: row.text_content }] : [],
    toolCalls: callsByTurn.get(row.turn_index),
  }));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function queryIndex(
  opts: PipelineOptions & { indexPath?: string },
): Promise<{ sessions: IndexedSessionResult[]; stale: boolean; error?: string } | null> {
  const dbPath = opts.indexPath ?? defaultIndexPath();
  if (!existsSync(dbPath)) return null;

  const runtime = await loadSqliteRuntime();
  if (!runtime) return null;

  let db: SqliteDatabase;
  let rebuiltFromBackup = false;
  try {
    ({ db, rebuiltFromBackup } = await openIndexDatabase(dbPath, runtime));
  } catch (err) {
    return {
      sessions: [],
      stale: true,
      error: isSqliteCorruption(err)
        ? "Index database is corrupt. Run `logsesh index clear && logsesh index build`."
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }

  if (rebuiltFromBackup) {
    db.close();
    return { sessions: [], stale: true };
  }

  try {
    const sourceRows = db
      .prepare("SELECT source_path, size_bytes, mtime_ms FROM sources")
      .all() as Array<{ source_path: string; size_bytes: number; mtime_ms: number }>;
    const indexedPaths = new Set(sourceRows.map((source) => source.source_path));
    let stale = false;
    for (const source of sourceRows) {
      try {
        const fileStat = await stat(source.source_path);
        if (
          Number(fileStat.size) !== Number(source.size_bytes) ||
          Math.trunc(fileStat.mtimeMs) !== Number(source.mtime_ms)
        ) {
          stale = true;
          break;
        }
      } catch {
        stale = true;
        break;
      }
    }

    if (!stale) {
      try {
        const adapters = await getEnabledAdapters(opts.toolFilter, undefined, opts);
        for await (const file of discoverFiles(opts, adapters)) {
          if (!indexedPaths.has(file.path)) {
            stale = true;
            break;
          }
        }
      } catch {
        stale = true;
      }
    }

    const rows = db
      .prepare(
        `SELECT sessions.*, sources.source_path, sources.lifecycle, sources.fingerprint
         FROM sessions JOIN sources ON sources.id = sessions.source_id`,
      )
      .all() as Array<Record<string, unknown>>;
    const parsed = parseQuery(opts.query ?? "");
    const results: IndexedSessionResult[] = [];
    for (const row of rows) {
      const sourcePath = String(row.source_path);
      const turns = loadTurns(db, String(row.session_key));
      const session = sessionFromRow(row, turns, sourcePath);
      if (!session) continue;
      if (!matchesSessionFilters(session, parsed, opts.projectFilter)) continue;
      if (!matchesDateRange(session.startedAt, session.endedAt, opts.since, opts.until)) continue;
      if (opts.toolFilter?.length && !opts.toolFilter.includes(session.tool)) continue;
      if (opts.queryTextFilter !== false && !matchesSessionTextQuery(session, parsed)) continue;
      results.push({ session, warnings: session.warnings ?? [] });
    }
    db.close();
    return { sessions: results, stale };
  } catch (err) {
    try {
      db.close();
    } catch {
      // ignore
    }
    return {
      sessions: [],
      stale: true,
      error: isSqliteCorruption(err)
        ? "Index database is corrupt. Run `logsesh index clear && logsesh index build`."
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }
}

export async function indexExists(indexPath?: string): Promise<boolean> {
  return existsSync(indexPath ?? defaultIndexPath());
}
