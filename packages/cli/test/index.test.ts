import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
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

describe("local index", () => {
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
});
