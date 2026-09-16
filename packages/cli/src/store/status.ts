import { existsSync } from "node:fs";
import { INDEX_SCHEMA_VERSION, defaultIndexPath } from "./paths.js";
import { isSqliteCorruption, loadSqliteRuntime, openIndexDatabase } from "./sqlite.js";

export interface IndexStatus {
  dbPath: string;
  available: boolean;
  sqlite: boolean;
  fts: boolean;
  schemaVersion?: string;
  sources: number;
  sessions: number;
  lastBuild?: string;
  broken?: boolean;
  error?: string;
}

export async function getIndexStatus(indexPath?: string): Promise<IndexStatus> {
  const dbPath = indexPath ?? defaultIndexPath();
  const runtime = await loadSqliteRuntime();
  if (!runtime) {
    return {
      dbPath,
      available: false,
      sqlite: false,
      fts: false,
      sources: 0,
      sessions: 0,
      error: "SQLite is unavailable in this Node runtime",
    };
  }
  if (!existsSync(dbPath)) {
    return {
      dbPath,
      available: false,
      sqlite: true,
      fts: runtime.fts,
      sources: 0,
      sessions: 0,
    };
  }

  try {
    const { db, fts } = await openIndexDatabase(dbPath, runtime);
    const schema = db.prepare("SELECT value FROM meta WHERE key = ?").get("schema_version") as
      | { value?: string }
      | undefined;
    const last = db.prepare("SELECT value FROM meta WHERE key = ?").get("last_build") as
      | { value?: string }
      | undefined;
    const sources = (db.prepare("SELECT COUNT(*) AS n FROM sources").get() as { n: number }).n;
    const sessions = (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    db.close();
    return {
      dbPath,
      available: true,
      sqlite: true,
      fts,
      schemaVersion: schema?.value ?? String(INDEX_SCHEMA_VERSION),
      sources,
      sessions,
      lastBuild: last?.value,
    };
  } catch (err) {
    return {
      dbPath,
      available: false,
      sqlite: true,
      fts: runtime.fts,
      sources: 0,
      sessions: 0,
      broken: isSqliteCorruption(err),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
