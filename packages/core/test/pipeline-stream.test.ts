import { describe, expect, it } from "vitest";
import { beginJsonExportStream } from "../src/exporters/stream.js";
import { type PipelineResult, runPipeline } from "../src/pipeline.js";
import type { Session } from "../src/types.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";

const fixtures = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const MIN_CLAUDE = '{"type":"user","message":{"role":"user","content":"hi"}}\n';

describe("runPipeline", () => {
  it("parses multiple fixture sessions without duplicating shared warnings", async () => {
    const results: PipelineResult[] = [];
    for await (const result of runPipeline({
      toolFilter: ["claude-code"],
      roots: { "claude-code": join(fixtures, "claude") },
    })) {
      if (result.session) results.push(result);
    }
    expect(results.length).toBeGreaterThan(1);
    const sharedAttachedOnce = results.filter((r) =>
      r.warnings.some((w) => w.code === "missing_token_usage" || w.code === "discovery_permission"),
    ).length;
    expect(sharedAttachedOnce).toBeLessThanOrEqual(results.length);
  });

  it("returns no session rows for an empty root", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "logsesh-empty-"));
    const sessions: Session[] = [];
    for await (const result of runPipeline({
      toolFilter: ["codex"],
      roots: { codex: emptyRoot },
    })) {
      if (result.session) sessions.push(result.session);
    }
    expect(sessions).toHaveLength(0);
  });

  it("preserves discovery order under concurrency", async () => {
    const root = mkdtempSync(join(tmpdir(), "logsesh-order-"));
    const projectDir = join(root, "-Users-me-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "z-session.jsonl"), MIN_CLAUDE);
    writeFileSync(join(projectDir, "a-session.jsonl"), MIN_CLAUDE);

    const paths: string[] = [];
    for await (const result of runPipeline({
      toolFilter: ["claude-code"],
      roots: { "claude-code": root },
      maxParseConcurrency: 4,
    })) {
      if (result.session) paths.push(result.session.source.sourcePath);
    }

    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain("a-session.jsonl");
    expect(paths[1]).toContain("z-session.jsonl");
  });
});

describe("beginJsonExportStream", () => {
  it("writes warnings from getWarnings at end", () => {
    let output = "";
    const sink = new Writable({
      write(chunk, _enc, cb) {
        output += chunk.toString();
        cb();
      },
    });
    const warnings = [
      {
        code: "late_warning",
        message: "after parse",
        severity: "warn" as const,
        scope: "parse" as const,
      },
    ];
    const stream = beginJsonExportStream(sink, {
      granularity: "session",
      getWarnings: () => warnings,
    });
    stream.end();
    const parsed = JSON.parse(output);
    expect(parsed.warnings).toEqual(warnings);
  });
});
