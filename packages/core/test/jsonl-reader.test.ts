import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEGRADED_HEAD_BYTES,
  DEFAULT_DEGRADED_TAIL_BYTES,
  DEFAULT_LARGE_FILE_THRESHOLD,
  DEFAULT_MAX_RECORD_BYTES,
} from "../src/constants.js";
import { planRead, readJsonl } from "../src/jsonl-reader.js";
import type { JsonlReadOptions, JsonlRow } from "../src/jsonl-reader.js";

const oversizedFixture = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/jsonl/oversized-then-valid.jsonl",
);

async function withFile(contents: string | Buffer, fn: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "logsesh-jsonl-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, contents);
  try {
    await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function collect(path: string, opts?: JsonlReadOptions): Promise<JsonlRow[]> {
  const rows: JsonlRow[] = [];
  for await (const row of readJsonl(path, opts)) rows.push(row);
  return rows;
}

describe("jsonl reader constants", () => {
  it("uses named byte budgets", () => {
    expect(DEFAULT_MAX_RECORD_BYTES).toBe(8 * 1024 * 1024);
    expect(DEFAULT_LARGE_FILE_THRESHOLD).toBe(512 * 1024 * 1024);
    expect(DEFAULT_DEGRADED_HEAD_BYTES).toBe(64 * 1024 * 1024);
    expect(DEFAULT_DEGRADED_TAIL_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe("planRead", () => {
  it("hard-skips only when maxFileBytes is set explicitly", () => {
    expect(planRead(100, { maxFileBytes: 50 })).toEqual({ kind: "skip", fileBytes: 100 });
    expect(planRead(200 * 1024 * 1024).kind).toBe("full");
    expect(planRead(DEFAULT_LARGE_FILE_THRESHOLD).kind).toBe("full");
    expect(planRead(DEFAULT_LARGE_FILE_THRESHOLD + 1).kind).toBe("degraded");
  });

  it("honors largeFileMode full and degraded", () => {
    expect(planRead(DEFAULT_LARGE_FILE_THRESHOLD + 10, { largeFileMode: "full" }).kind).toBe(
      "full",
    );
    const degraded = planRead(100, {
      largeFileMode: "degraded",
      headBytes: 20,
      tailBytes: 20,
    });
    expect(degraded).toMatchObject({
      kind: "degraded",
      headBytes: 20,
      tailBytes: 20,
      tailStart: 80,
    });
    expect(planRead(30, { largeFileMode: "degraded", headBytes: 20, tailBytes: 20 }).kind).toBe(
      "full",
    );
  });
});

describe("readJsonl", () => {
  it("parses LF records with line numbers", async () => {
    await withFile('{"a":1}\n{"a":2}\n', async (file) => {
      const rows = await collect(file);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ kind: "record", seq: 1, line: 1, offset: 0, json: { a: 1 } });
      expect(rows[1]).toMatchObject({ kind: "record", seq: 2, line: 2, json: { a: 2 } });
    });
  });

  it("parses CRLF records", async () => {
    await withFile('{"a":1}\r\n{"a":2}\r\n', async (file) => {
      const rows = await collect(file);
      expect(rows.map((r) => (r.kind === "record" ? r.json : r.kind))).toEqual([
        { a: 1 },
        { a: 2 },
      ]);
    });
  });

  it("skips empty lines but keeps later line numbers", async () => {
    await withFile('{"a":1}\n\n{"a":2}\n', async (file) => {
      const rows = await collect(file);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ kind: "record", line: 1, json: { a: 1 } });
      expect(rows[1]).toMatchObject({ kind: "record", line: 3, seq: 3, json: { a: 2 } });
    });
  });

  it("parses a final line without a newline", async () => {
    await withFile('{"a":1}\n{"a":2}', async (file) => {
      const rows = await collect(file);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ kind: "record", json: { a: 2 } });
    });
  });

  it("yields malformed JSON and continues", async () => {
    await withFile('{"a":1}\nnot-json\n{"a":3}\n', async (file) => {
      const rows = await collect(file);
      expect(rows.map((r) => r.kind)).toEqual(["record", "malformed", "record"]);
      expect(rows[1]).toMatchObject({ kind: "malformed", line: 2 });
      if (rows[1]?.kind === "malformed") expect(rows[1].cause.length).toBeGreaterThan(0);
    });
  });

  it("reassembles 1-byte chunks including a UTF-8 split", async () => {
    await withFile('{"v":"é你好"}\n{"ok":true}\n', async (file) => {
      const rows = await collect(file, { chunkSize: 1 });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ kind: "record", json: { v: "é你好" } });
      expect(rows[1]).toMatchObject({ kind: "record", json: { ok: true } });
    });
  });

  it("recovers after an oversized line", async () => {
    const rows = await collect(oversizedFixture, { maxRecordBytes: 32 });
    expect(rows[0]).toMatchObject({ kind: "oversized", line: 1 });
    expect(rows[1]).toMatchObject({ kind: "record", json: { ok: true, n: 2 } });
    if (rows[0]?.kind === "oversized") {
      expect(rows[0].bytes).toBeGreaterThan(32);
    }
  });

  it("reads degraded head and tail windows on a tiny file", async () => {
    const lines = [1, 2, 3, 4, 5].map((id) => `{"id":${id}}\n`).join("");
    await withFile(lines, async (file) => {
      const lineBytes = Buffer.byteLength(`{"id":1}\n`);
      const rows = await collect(file, {
        largeFileMode: "degraded",
        headBytes: lineBytes,
        tailBytes: lineBytes,
        chunkSize: 1,
      });
      expect(rows[0]).toMatchObject({ kind: "record", json: { id: 1 }, line: 1 });
      expect(rows.some((r) => r.kind === "gap" && r.reason === "degraded-middle")).toBe(true);
      const last = rows[rows.length - 1];
      expect(last).toMatchObject({ kind: "record", json: { id: 5 } });
      if (last?.kind === "record") expect(last.line).toBeUndefined();
    });
  });

  it("yields nothing for an empty file", async () => {
    await withFile("", async (file) => {
      expect(await collect(file)).toEqual([]);
    });
  });
});
