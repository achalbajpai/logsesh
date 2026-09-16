import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "@logsesh/core";
import { buildIndex, clearIndex } from "../src/store/build.js";
import { queryIndex } from "../src/store/query.js";
import { loadSqliteRuntime } from "../src/store/sqlite.js";
import { getIndexStatus } from "../src/store/status.js";
import { iterateSessions } from "../src/util/session-source.js";

const root = join(fileURLToPath(new URL("../../..", import.meta.url)));
const claudeRoot = join(root, "packages/core/test/fixtures/claude");

async function isolatedRoots(dir: string, claudeLogs: string) {
  const empty = {
    codex: join(dir, "empty-codex"),
    gemini: join(dir, "empty-gemini"),
    antigravity: join(dir, "empty-antigravity"),
  };
  await mkdir(empty.codex, { recursive: true });
  await mkdir(empty.gemini, { recursive: true });
  await mkdir(empty.antigravity, { recursive: true });
  return {
    "claude-code": claudeLogs,
    ...empty,
  };
}

async function countFtsRows(path: string): Promise<number | undefined> {
  const runtime = await loadSqliteRuntime();
  if (!runtime?.fts) return undefined;
  const db = runtime.open(path);
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM transcript_fts").get();
    if (!row || typeof row !== "object" || !("n" in row)) return undefined;
    return typeof row.n === "number" ? row.n : Number(row.n);
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

describe("local index", { timeout: 20_000 }, () => {
  let dbPath = "";

  afterEach(async () => {
    if (dbPath) {
      await rm(dbPath, { force: true });
      await rm(`${dbPath}.bak`, { force: true });
    }
  });

  it("builds from fixture files and returns the same session ids as a live scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "logsesh-index-"));
    dbPath = join(dir, "index-v1.sqlite");

    const liveIds: string[] = [];
    for await (const result of runPipeline({
      roots: { "claude-code": claudeRoot },
      toolFilter: ["claude-code"],
    })) {
      if (result.session) liveIds.push(result.session.id);
    }
    expect(liveIds.length).toBeGreaterThan(0);

    const built = await buildIndex({
      roots: { "claude-code": claudeRoot },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(built.error).toBeUndefined();
    expect(built.ok).toBe(true);
    expect(built.sessions).toBe(liveIds.length);
    expect(built.sources).toBeGreaterThan(0);

    const status = await getIndexStatus(dbPath);
    expect(status.available).toBe(true);
    expect(status.sessions).toBe(liveIds.length);
    expect(status.broken).toBeUndefined();

    const indexed = await queryIndex({
      roots: { "claude-code": claudeRoot },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(indexed?.error).toBeUndefined();
    expect(indexed?.stale).toBe(false);
    const indexedIds = (indexed?.sessions ?? []).map((entry) => entry.session.id).sort();
    expect(indexedIds).toEqual([...liveIds].sort());

    const rebuilt = await buildIndex({
      roots: { "claude-code": claudeRoot },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(rebuilt.skippedUnchanged).toBe(liveIds.length);

    const cleared = await clearIndex(dbPath);
    expect(cleared.existed).toBe(true);
  });

  it("marks the index stale when a new session file appears", async () => {
    const dir = await mkdtemp(join(tmpdir(), "logsesh-index-new-"));
    dbPath = join(dir, "index-v1.sqlite");
    const logs = join(dir, "logs");
    await mkdir(logs, { recursive: true });
    await copyFile(join(claudeRoot, "fragment-merge.jsonl"), join(logs, "one.jsonl"));

    const built = await buildIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(built.ok).toBe(true);
    expect(built.sessions).toBe(1);

    const before = await queryIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(before?.stale).toBe(false);
    expect(before?.sessions).toHaveLength(1);

    await copyFile(join(claudeRoot, "unmatched-result.jsonl"), join(logs, "two.jsonl"));

    const after = await queryIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(after?.stale).toBe(true);
    expect(after?.sessions).toHaveLength(1);

    const live: string[] = [];
    const notices: string[] = [];
    for await (const result of iterateSessions({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    })) {
      for (const warning of result.warnings) notices.push(warning.code);
      if (result.session) live.push(result.session.id);
    }
    expect(notices).toContain("index_stale");
    expect(live).toHaveLength(2);
  });

  it("falls back to a live scan after a schema-triggered rebuild", async () => {
    const dir = await mkdtemp(join(tmpdir(), "logsesh-index-schema-"));
    dbPath = join(dir, "index-v1.sqlite");
    const logs = join(dir, "logs");
    await mkdir(logs, { recursive: true });
    await copyFile(join(claudeRoot, "fragment-merge.jsonl"), join(logs, "one.jsonl"));

    const built = await buildIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(built.ok).toBe(true);
    expect(built.sessions).toBe(1);

    const runtime = await loadSqliteRuntime();
    expect(runtime).not.toBeNull();
    if (!runtime) return;
    const db = runtime.open(dbPath);
    db.prepare("UPDATE meta SET value = ? WHERE key = ?").run("0", "schema_version");
    db.close();

    const indexed = await queryIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(indexed?.stale).toBe(true);
    expect(indexed?.sessions).toHaveLength(0);

    const live: string[] = [];
    for await (const result of iterateSessions({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    })) {
      if (result.session) live.push(result.session.id);
    }
    expect(live).toHaveLength(1);
  });

  it("prunes vanished sources when Commander supplies an empty project filter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "logsesh-index-prune-"));
    dbPath = join(dir, "index-v1.sqlite");
    const logs = join(dir, "logs");
    await mkdir(logs, { recursive: true });
    await copyFile(join(claudeRoot, "fragment-merge.jsonl"), join(logs, "keep.jsonl"));
    await copyFile(join(claudeRoot, "unmatched-result.jsonl"), join(logs, "gone.jsonl"));
    const roots = await isolatedRoots(dir, logs);

    const built = await buildIndex({
      roots,
      projectFilter: [],
      indexPath: dbPath,
    });
    expect(built.ok).toBe(true);
    expect(built.sources).toBe(2);

    await unlink(join(logs, "gone.jsonl"));

    const stale = await queryIndex({
      roots,
      projectFilter: [],
      indexPath: dbPath,
    });
    expect(stale?.stale).toBe(true);

    const refreshed = await buildIndex({
      roots,
      projectFilter: [],
      indexPath: dbPath,
    });
    expect(refreshed.ok).toBe(true);
    expect(refreshed.sources).toBe(1);

    const after = await queryIndex({
      roots,
      projectFilter: [],
      indexPath: dbPath,
    });
    expect(after?.stale).toBe(false);
    expect(after?.sessions).toHaveLength(1);
  });

  it("does not accumulate FTS rows when a changed session is refreshed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "logsesh-index-fts-"));
    dbPath = join(dir, "index-v1.sqlite");
    const logs = join(dir, "logs");
    await mkdir(logs, { recursive: true });
    await copyFile(join(claudeRoot, "fragment-merge.jsonl"), join(logs, "one.jsonl"));

    const built = await buildIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(built.ok).toBe(true);
    expect(built.fts).toBe(true);

    const before = await countFtsRows(dbPath);
    expect(before).toBe(1);

    const source = join(logs, "one.jsonl");
    const original = await readFile(source, "utf8");
    await writeFile(source, original.replace("Hello", "Hello again"));
    const firstRefresh = await buildIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(firstRefresh.ok).toBe(true);
    expect(firstRefresh.skippedUnchanged).toBe(0);

    await writeFile(source, original.replace("Hello", "Hello once more"));
    const secondRefresh = await buildIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(secondRefresh.ok).toBe(true);
    expect(secondRefresh.skippedUnchanged).toBe(0);

    const after = await countFtsRows(dbPath);
    expect(after).toBe(1);
  });

  it("returns parse warnings from indexed sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "logsesh-index-warn-"));
    dbPath = join(dir, "index-v1.sqlite");
    const logs = join(dir, "logs");
    await mkdir(logs, { recursive: true });
    await copyFile(join(claudeRoot, "malformed.jsonl"), join(logs, "malformed.jsonl"));

    const liveCodes: string[] = [];
    for await (const result of runPipeline({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
    })) {
      for (const warning of result.warnings) liveCodes.push(warning.code);
      for (const warning of result.session?.warnings ?? []) liveCodes.push(warning.code);
    }
    expect(liveCodes).toContain("malformed_record");

    const built = await buildIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(built.ok).toBe(true);

    const indexed = await queryIndex({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    });
    expect(indexed?.stale).toBe(false);
    expect(indexed?.sessions).toHaveLength(1);
    const indexedCodes = [
      ...(indexed?.sessions[0]?.warnings ?? []).map((warning) => warning.code),
      ...(indexed?.sessions[0]?.session.warnings ?? []).map((warning) => warning.code),
    ];
    expect(indexedCodes).toContain("malformed_record");

    const fromIndex: string[] = [];
    for await (const result of iterateSessions({
      roots: { "claude-code": logs },
      toolFilter: ["claude-code"],
      indexPath: dbPath,
    })) {
      expect(result.warnings.some((warning) => warning.code === "index_stale")).toBe(false);
      for (const warning of result.warnings) fromIndex.push(warning.code);
    }
    expect(fromIndex).toContain("malformed_record");
  });
});
