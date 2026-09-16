import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JsonlRow, planJsonlScan, readJsonl } from "../src/jsonl-reader.js";

async function writeTemp(contents: Buffer | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "logsesh-jsonl-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, contents);
  return file;
}

describe("planJsonlScan", () => {
  it("skips only when maxFileBytes is set and the file is larger", () => {
    expect(planJsonlScan(100, { maxFileBytes: 10 }).mode).toBe("skip");
    expect(planJsonlScan(100).mode).toBe("full");
    expect(
      planJsonlScan(1000, {
        largeFileMode: "auto",
        largeFileThreshold: 50,
        headBytes: 10,
        tailBytes: 10,
      }).mode,
    ).toBe("degraded");
  });

  it("uses a single range when head and tail overlap", () => {
    const plan = planJsonlScan(100, {
      largeFileMode: "degraded",
      headBytes: 80,
      tailBytes: 80,
    });
    expect(plan.mode).toBe("full");
    expect(plan.ranges).toEqual([{ start: 0, end: 100 }]);
  });
});

describe("readJsonl", () => {
  it("reads LF, CRLF, empty lines, and a final line without newline", async () => {
    const file = await writeTemp('{"a":1}\r\n\n{"b":2}\n{"c":3}');
    const lines: string[] = [];
    const result = await readJsonl(file, (row) => {
      if (row.kind === "line") lines.push(row.text);
    });
    expect(result.skipped).toBe(false);
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("recovers after an oversized record when using 1-byte chunks", async () => {
    const big = "x".repeat(40);
    const file = await writeTemp(`{"ok":1}\n${big}\n{"ok":2}\n`);
    const rows: JsonlRow[] = [];
    await readJsonl(
      file,
      (row) => {
        rows.push(row);
      },
      { maxRecordBytes: 10, chunkBytes: 1 },
    );
    const kinds = rows.map((row) => row.kind);
    expect(kinds).toContain("oversized");
    expect(
      rows.filter((row) => row.kind === "line").map((row) => row.kind === "line" && row.text),
    ).toEqual(['{"ok":1}', '{"ok":2}']);
  });

  it("reads head and tail of a large file in degraded mode", async () => {
    const head = `${JSON.stringify({ id: "head" })}\n`;
    const middle = `${JSON.stringify({ id: "middle" })}\n`.repeat(20);
    const tail = `${JSON.stringify({ id: "tail" })}\n`;
    const file = await writeTemp(head + middle + tail);
    const ids: string[] = [];
    const result = await readJsonl(
      file,
      (row) => {
        if (row.kind === "line") ids.push(JSON.parse(row.text).id);
      },
      {
        largeFileMode: "degraded",
        headBytes: head.length,
        tailBytes: tail.length,
        largeFileThreshold: 1,
      },
    );
    expect(result.mode).toBe("degraded");
    expect(ids[0]).toBe("head");
    expect(ids.at(-1)).toBe("tail");
    expect(ids).not.toContain("middle");
  });

  it("skips a straddling first tail line and keeps the following complete line", async () => {
    const head = `${JSON.stringify({ id: "head" })}\n`;
    const middle = `${JSON.stringify({ id: "middle" })}\n`.repeat(8);
    const straddle = `NOTJSON\n${JSON.stringify({ id: "keep" })}\n`;
    const file = await writeTemp(head + middle + straddle);
    const tailBytes = `JSON\n${JSON.stringify({ id: "keep" })}\n`.length;
    const ids: string[] = [];
    const result = await readJsonl(
      file,
      (row) => {
        if (row.kind === "line") ids.push(JSON.parse(row.text).id);
      },
      { largeFileMode: "degraded", headBytes: head.length, tailBytes, largeFileThreshold: 1 },
    );
    expect(result.mode).toBe("degraded");
    expect(ids[0]).toBe("head");
    expect(ids).toContain("keep");
    expect(ids).not.toContain("middle");
    expect(ids.some((id) => id === undefined)).toBe(false);
  });

  it("does not emit a truncated leftover at a degraded head boundary", async () => {
    const headLine = `${JSON.stringify({ id: "head" })}\n`;
    const cut = '{"id":"fir';
    const rest = `st-complete"}\n${JSON.stringify({ id: "middle" })}\n`.repeat(8);
    const tail = `${JSON.stringify({ id: "tail" })}\n`;
    const file = await writeTemp(headLine + cut + rest + tail);
    const lines: string[] = [];
    const result = await readJsonl(
      file,
      (row) => {
        if (row.kind === "line") lines.push(row.text);
      },
      {
        largeFileMode: "degraded",
        headBytes: headLine.length + cut.length,
        tailBytes: tail.length,
        largeFileThreshold: 1,
        chunkBytes: 1,
      },
    );
    expect(result.mode).toBe("degraded");
    expect(lines).toContain(JSON.stringify({ id: "head" }));
    expect(lines).toContain(JSON.stringify({ id: "tail" }));
    expect(lines).not.toContain(cut);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("returns skipped for an explicit maxFileBytes cap", async () => {
    const file = await writeTemp("hello\n");
    const result = await readJsonl(file, () => undefined, { maxFileBytes: 1 });
    expect(result.skipped).toBe(true);
    expect(result.mode).toBe("skip");
  });

  it("handles an empty file", async () => {
    const file = await writeTemp("");
    const rows: JsonlRow[] = [];
    const result = await readJsonl(file, (row) => rows.push(row));
    expect(result.skipped).toBe(false);
    expect(rows).toEqual([]);
  });
});
