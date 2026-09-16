import type { PipelineOptions, Session, Warning } from "@logsesh/core";
import { mergeWarnings, runPipeline } from "@logsesh/core";
import { sessionKey, sourceFingerprint } from "./fingerprint.js";
import { defaultIndexPath } from "./paths.js";
import {
  type SqliteDatabase,
  isSqliteCorruption,
  loadSqliteRuntime,
  openIndexDatabase,
} from "./sqlite.js";

export interface IndexBuildOptions extends PipelineOptions {
  rebuild?: boolean;
  indexPath?: string;
}

export interface IndexBuildResult {
  ok: boolean;
  dbPath: string;
  sources: number;
  sessions: number;
  skippedUnchanged: number;
  failed: number;
  fts: boolean;
  warnings: Warning[];
  error?: string;
}

function turnText(session: Session, index: number): string {
  const turn = session.turns[index];
  if (!turn) return "";
  return turn.content
    .filter((block) => block.kind === "text")
    .map((block) => (block.kind === "text" ? block.text : ""))
    .join("\n");
}

function insertSession(db: SqliteDatabase, sourceId: number, session: Session, fts: boolean): void {
  const key = sessionKey(session.tool, session.source.sourcePath, session.id);
  db.prepare(
    `INSERT INTO sessions (
      session_key, source_id, session_id, tool, project_path, branch, model,
      parent_session_id, agent_id, agent_type, originator, depth,
      started_at, ended_at, turn_count, total_tokens, cost_usd, usage_json, completeness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    key,
    sourceId,
    session.id,
    session.tool,
    session.projectPath ?? null,
    session.branch ?? null,
    session.model ?? null,
    session.lineage?.parentSessionId ?? null,
    session.lineage?.agentId ?? null,
    session.lineage?.agentType ?? null,
    session.lineage?.originator ?? null,
    session.lineage?.depth ?? null,
    session.startedAt ?? null,
    session.endedAt ?? null,
    session.turns.length,
    session.usage?.totalTokens ?? null,
    session.costUsd,
    session.usage ? JSON.stringify(session.usage) : null,
    session.fidelity?.completeness ?? "complete",
  );

  for (const turn of session.turns) {
    db.prepare(
      `INSERT INTO turns (session_key, turn_index, role, timestamp, text_content)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(key, turn.index, turn.role, turn.timestamp ?? null, turnText(session, turn.index));
    for (const call of turn.toolCalls ?? []) {
      db.prepare(
        `INSERT INTO tool_calls (session_key, turn_index, call_id, name, status, input_text, output_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        key,
        turn.index,
        call.id,
        call.name,
        call.status ?? null,
        call.input === undefined ? null : JSON.stringify(call.input),
        call.output === undefined
          ? null
          : typeof call.output === "string"
            ? call.output
            : JSON.stringify(call.output),
      );
    }
  }

  if (fts) {
    const content = session.turns
      .filter((turn) => turn.role === "user" || turn.role === "assistant")
      .map((turn) => turnText(session, turn.index))
      .filter(Boolean)
      .join("\n");
    if (content) {
      db.prepare("INSERT INTO transcript_fts (session_key, content) VALUES (?, ?)").run(
        key,
        content,
      );
    }
  }
}

export async function buildIndex(opts: IndexBuildOptions = {}): Promise<IndexBuildResult> {
  const dbPath = opts.indexPath ?? defaultIndexPath();
  const warnings: Warning[] = [];
  const runtime = await loadSqliteRuntime();
  if (!runtime) {
    return {
      ok: false,
      dbPath,
      sources: 0,
      sessions: 0,
      skippedUnchanged: 0,
      failed: 0,
      fts: false,
      warnings,
      error: "SQLite is unavailable in this Node runtime. Commands fall back to a live scan.",
    };
  }

  let db: SqliteDatabase;
  let fts: boolean;
  try {
    ({ db, fts } = await openIndexDatabase(dbPath, runtime));
  } catch (err) {
    return {
      ok: false,
      dbPath,
      sources: 0,
      sessions: 0,
      skippedUnchanged: 0,
      failed: 0,
      fts: false,
      warnings,
      error: isSqliteCorruption(err)
        ? "Index database is corrupt. Run `logsesh index clear && logsesh index build`."
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }

  if (opts.rebuild) {
    db.exec("DELETE FROM tool_calls");
    db.exec("DELETE FROM turns");
    db.exec("DELETE FROM sessions");
    db.exec("DELETE FROM sources");
    if (fts) {
      try {
        db.exec("DELETE FROM transcript_fts");
      } catch {
        // FTS table may not exist
      }
    }
  }

  const existing = new Map<string, { fingerprint: string | null }>();
  for (const row of db.prepare("SELECT source_path, fingerprint FROM sources").all() as Array<{
    source_path: string;
    fingerprint: string | null;
  }>) {
    existing.set(row.source_path, { fingerprint: row.fingerprint });
  }

  const seenPaths = new Set<string>();
  let skippedUnchanged = 0;
  let failed = 0;
  let sessions = 0;

  try {
    for await (const result of runPipeline(opts)) {
      mergeWarnings(warnings, result.warnings);
      const session = result.session;
      if (!session) continue;
      const sourcePath = session.source.sourcePath;
      seenPaths.add(sourcePath);

      let fingerprint: string;
      let size: number;
      let mtimeMs: number;
      try {
        ({ fingerprint, size, mtimeMs } = await sourceFingerprint(sourcePath));
      } catch {
        failed += 1;
        continue;
      }

      const previous = existing.get(sourcePath);
      if (!opts.rebuild && previous?.fingerprint === fingerprint) {
        skippedUnchanged += 1;
        sessions += 1;
        continue;
      }

      try {
        db.exec("BEGIN");
        db.prepare("DELETE FROM sources WHERE source_path = ?").run(sourcePath);
        db.prepare(
          `INSERT INTO sources (
            tool, source_path, lifecycle, size_bytes, mtime_ms, fingerprint,
            adapter_version, indexed_at, completeness, warning_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          session.tool,
          sourcePath,
          session.source.lifecycle ?? null,
          size,
          mtimeMs,
          fingerprint,
          session.source.adapterVersion,
          new Date().toISOString(),
          session.fidelity?.completeness ?? "complete",
          session.warnings?.length ?? 0,
        );
        const sourceRow = db
          .prepare("SELECT id FROM sources WHERE source_path = ?")
          .get(sourcePath) as {
          id: number;
        };
        insertSession(db, sourceRow.id, session, fts);
        db.exec("COMMIT");
        sessions += 1;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        failed += 1;
        warnings.push({
          code: "index_unavailable",
          message: `Failed to index ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
          severity: "warn",
          scope: "index",
          sourcePath,
          sessionId: session.id,
        });
      }
    }

    for (const path of existing.keys()) {
      if (
        !seenPaths.has(path) &&
        !opts.toolFilter?.length &&
        !opts.projectFilter &&
        !opts.query &&
        !opts.since &&
        !opts.until
      ) {
        db.prepare("DELETE FROM sources WHERE source_path = ?").run(path);
      }
    }

    const sourceCount = (db.prepare("SELECT COUNT(*) AS n FROM sources").get() as { n: number }).n;
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)").run(
      "last_build",
      new Date().toISOString(),
    );
    db.close();
    return {
      ok: failed === 0,
      dbPath,
      sources: sourceCount,
      sessions,
      skippedUnchanged,
      failed,
      fts,
      warnings,
    };
  } catch (err) {
    try {
      db.close();
    } catch {
      // ignore
    }
    return {
      ok: false,
      dbPath,
      sources: 0,
      sessions,
      skippedUnchanged,
      failed,
      fts,
      warnings,
      error: isSqliteCorruption(err)
        ? "Index database is corrupt. Run `logsesh index clear && logsesh index build`."
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }
}

export async function clearIndex(
  indexPath?: string,
): Promise<{ dbPath: string; existed: boolean }> {
  const { rm } = await import("node:fs/promises");
  const dbPath = indexPath ?? defaultIndexPath();
  try {
    await rm(dbPath);
    return { dbPath, existed: true };
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return { dbPath, existed: false };
    throw err;
  }
}
