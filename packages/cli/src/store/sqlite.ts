import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { INDEX_DIR_MODE, INDEX_FILE_MODE } from "@logsesh/core";
import { FTS_DDL, INDEX_DDL } from "./schema.js";
import { INDEX_SCHEMA_VERSION } from "./paths.js";

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export interface SqliteRuntime {
  open(path: string): SqliteDatabase;
  fts: boolean;
}

export async function loadSqliteRuntime(): Promise<SqliteRuntime | null> {
  try {
    const mod = (await import("node:sqlite")) as {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
    if (typeof mod.DatabaseSync !== "function") return null;
    const probe = new mod.DatabaseSync(":memory:");
    let fts = false;
    try {
      probe.exec("CREATE VIRTUAL TABLE probe_fts USING fts5(x)");
      fts = true;
    } catch {
      fts = false;
    }
    probe.close();
    return {
      fts,
      open(path: string) {
        return new mod.DatabaseSync(path);
      },
    };
  } catch {
    return null;
  }
}

export async function openIndexDatabase(
  dbPath: string,
  runtime: SqliteRuntime,
): Promise<{ db: SqliteDatabase; fts: boolean; rebuiltFromBackup: boolean }> {
  const dir = dirname(dbPath);
  await mkdir(dir, { recursive: true, mode: INDEX_DIR_MODE });
  try {
    await chmod(dir, INDEX_DIR_MODE);
  } catch {
    // Windows and some filesystems ignore mode.
  }
  const db = runtime.open(dbPath);
  try {
    await chmod(dbPath, INDEX_FILE_MODE);
  } catch {
    // Windows and some filesystems ignore mode.
  }
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  let rebuiltFromBackup = false;
  try {
    db.exec(INDEX_DDL);
  } catch (err) {
    db.close();
    throw err;
  }

  const versionRow = db.prepare("SELECT value FROM meta WHERE key = ?").get("schema_version") as
    | { value?: string }
    | undefined;
  const version = versionRow?.value;
  if (version && version !== String(INDEX_SCHEMA_VERSION)) {
    db.close();
    const { rename } = await import("node:fs/promises");
    await rename(dbPath, `${dbPath}.bak`);
    rebuiltFromBackup = true;
    const fresh = runtime.open(dbPath);
    try {
      await chmod(dbPath, INDEX_FILE_MODE);
    } catch {
      // ignore
    }
    fresh.exec("PRAGMA foreign_keys = ON");
    fresh.exec(INDEX_DDL);
    fresh
      .prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)")
      .run("schema_version", String(INDEX_SCHEMA_VERSION));
    const fts = tryFts(fresh, runtime.fts);
    return { db: fresh, fts, rebuiltFromBackup };
  }

  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)").run(
    "schema_version",
    String(INDEX_SCHEMA_VERSION),
  );
  const fts = tryFts(db, runtime.fts);
  return { db, fts, rebuiltFromBackup };
}

function tryFts(db: SqliteDatabase, wantFts: boolean): boolean {
  if (!wantFts) return false;
  try {
    db.exec(FTS_DDL);
    return true;
  } catch {
    return false;
  }
}

export function isSqliteCorruption(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /malformed|corrupt|not a database/i.test(message);
}
