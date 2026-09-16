import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PARSE_WARNING_CODES } from "../src/constants.js";
import { ParseContext } from "../src/parse-context.js";

async function withFile(contents: string, fn: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "logsesh-ctx-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, contents);
  try {
    await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const lineSchema = z.object({ type: z.string() });

describe("PARSE_WARNING_CODES", () => {
  it("includes existing and new parse codes", () => {
    expect(PARSE_WARNING_CODES).toEqual(
      expect.arrayContaining([
        "malformed_line",
        "invalid_line_shape",
        "file_too_large",
        "skipped_role",
        "dropped_encrypted_reasoning",
        "missing_token_usage",
        "truncated_tool_output",
        "unmatched_tool_result",
        "truncated_turn",
        "discovery_error",
        "discovery_permission",
        "unknown_record_type",
        "unknown_content_block",
        "oversized_record",
        "partial_large_file",
        "duplicate_event_ordinal",
        "unsupported_usage_shape",
        "source_changed_during_scan",
      ]),
    );
  });
});

describe("ParseContext", () => {
  it("counts unknown types into one summary and ignores known-noise types", async () => {
    const body = [
      `{"type":"user"}`,
      `{"type":"mode"}`,
      `{"type":"mode"}`,
      `{"type":"atis-latch"}`,
      `{"type":"queue-operation"}`,
      "",
    ].join("\n");

    await withFile(body, async (path) => {
      const ctx = new ParseContext({
        tool: "claude-code",
        adapterVersion: "0.1.1",
        file: { path, tool: "claude-code" },
        sessionId: "s1",
      });

      for await (const rec of ctx.records()) {
        const parsed = ctx.decode(rec, lineSchema, "Claude record");
        if (!parsed) continue;
        if (parsed.type === "queue-operation") {
          ctx.ignoreRecord(parsed.type);
          continue;
        }
        if (parsed.type === "user") {
          ctx.addRecord({
            role: "user",
            sourceLine: rec.seq,
            blocks: [{ kind: "text", text: "hi" }],
          });
          continue;
        }
        ctx.unknownRecord(parsed.type);
      }

      const session = ctx.finish();
      expect(session.fidelity?.completeness).toBe("complete");
      expect(session.fidelity?.recordsUnknown).toBe(3);
      expect(session.warnings?.filter((w) => w.code === "unknown_record_type")).toHaveLength(1);
      expect(session.warnings?.find((w) => w.code === "unknown_record_type")?.cause).toBe(
        "atis-latch:1, mode:2",
      );
      expect(session.turns).toHaveLength(1);
    });
  });

  it("skips the whole file when maxFileBytes is set explicitly", async () => {
    await withFile('{"type":"user"}\n', async (path) => {
      const ctx = new ParseContext({
        tool: "gemini",
        adapterVersion: "0.1.1-experimental",
        file: { path, tool: "gemini" },
        sessionId: "s1",
        opts: { maxFileBytes: 1 },
      });
      for await (const _rec of ctx.records()) {
        ctx.unknownRecord("should-not-run");
      }
      const session = ctx.finish();
      expect(session.warnings?.some((w) => w.code === "file_too_large")).toBe(true);
      expect(session.fidelity?.completeness).toBe("metadata-only");
      expect(session.turns).toHaveLength(0);
    });
  });
});
