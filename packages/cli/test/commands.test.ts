import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDebug } from "../src/commands/debug.js";
import { runDoctorCommand } from "../src/commands/doctor.js";
import { runExport } from "../src/commands/export.js";
import { runList } from "../src/commands/list.js";
import { runSearch } from "../src/commands/search.js";
import { runStats } from "../src/commands/stats.js";

const root = join(fileURLToPath(new URL("../../..", import.meta.url)));
const claudeRoot = join(root, "packages/core/test/fixtures/claude");

const claudeOpts = {
  roots: [`claude-code:${claudeRoot}`],
  tool: "claude-code",
};

describe("command handlers", () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const stdoutChunks: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    stdoutChunks.length = 0;
    vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runList returns json envelope with sessions", async () => {
    expect(await runList({ ...claudeOpts, json: true })).toBe(0);
    const body = JSON.parse(logs.join("\n"));
    expect(body.format).toBe("logsesh.list.v1");
    expect(body.sessions.length).toBeGreaterThan(0);
  });

  it("runList returns 1 for empty json results", async () => {
    expect(await runList({ ...claudeOpts, json: true, query: "zzzznotfound" })).toBe(1);
    expect(JSON.parse(logs.join("\n")).sessions).toHaveLength(0);
  });

  it("runList prints human table output", async () => {
    expect(await runList(claudeOpts)).toBe(0);
    expect(logs.join("\n")).toContain("claude-code");
  });

  it("runList prints empty state for no matches", async () => {
    expect(await runList({ ...claudeOpts, query: "zzzznotfound" })).toBe(0);
    expect(logs.join("\n")).toContain("no sessions matched");
    expect(logs.join("\n")).toContain("query=zzzznotfound");
  });

  it("runList treats multiple project filters as OR", async () => {
    expect(
      await runList({
        ...claudeOpts,
        project: ["claude", "zzzznotfound"],
        json: true,
      }),
    ).toBe(0);
    expect(JSON.parse(logs.join("\n")).sessions.length).toBeGreaterThan(0);
  });

  it("runStats returns json envelope", async () => {
    expect(await runStats({ ...claudeOpts, json: true, estimateCost: true })).toBe(0);
    const body = JSON.parse(logs.join("\n"));
    expect(body.format).toBe("logsesh.stats.v1");
    expect(body.stats.sessionCount).toBeGreaterThan(0);
  });

  it("runStats returns 1 for empty json results", async () => {
    expect(await runStats({ ...claudeOpts, json: true, query: "zzzznotfound" })).toBe(1);
    expect(JSON.parse(logs.join("\n")).stats.sessionCount).toBe(0);
  });

  it("runStats prints human summary lines", async () => {
    expect(await runStats({ ...claudeOpts, estimateCost: true })).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("Sessions");
    expect(out).toContain("Logged cost");
    expect(out).toContain("Estimated cost");
  });

  it("runStats prints empty state for no matches", async () => {
    expect(await runStats({ ...claudeOpts, query: "zzzznotfound" })).toBe(0);
    expect(logs.join("\n")).toContain("no sessions matched");
  });

  it("runDoctorCommand returns json report", async () => {
    expect(await runDoctorCommand({ json: true, roots: claudeOpts.roots })).toBe(0);
    const body = JSON.parse(logs.join("\n"));
    expect(body.format).toBe("logsesh.doctor.v1");
    expect(body.pricing.modelCount).toBeGreaterThan(0);
    expect(body.pricing.sources.map((source: { url: string }) => source.url)).toEqual(
      expect.arrayContaining([
        "https://platform.openai.com/docs/pricing",
        "https://docs.anthropic.com/en/docs/about-claude/pricing",
        "https://platform.claude.com/docs/en/about-claude/model-deprecations",
      ]),
    );
  });

  it("runDoctorCommand prints human report", async () => {
    expect(await runDoctorCommand({ roots: claudeOpts.roots })).toBe(0);
    const out = logs.join("\n");
    expect(out).toMatch(/^Pricing table/);
    expect(out).toContain("Pricing table");
    expect(out).toContain("sources:");
    expect(out).toContain("platform.openai.com/docs/pricing");
    expect(out).toContain("docs.anthropic.com/en/docs/about-claude/pricing");
    expect(out).toContain("Adapters");
  });

  it("runDoctorCommand rejects invalid roots", async () => {
    expect(await runDoctorCommand({ roots: ["codex/tmp"] })).toBe(2);
    expect(errors.join("\n")).toContain("Invalid --roots");
  });

  it("runSearch returns 1 when nothing matches", async () => {
    expect(
      await runSearch({
        ...claudeOpts,
        searchQuery: "zzzznotfound",
        json: true,
      }),
    ).toBe(1);
    expect(JSON.parse(logs.join("\n")).matches).toHaveLength(0);
  });

  it("runSearch returns matches for project filter", async () => {
    expect(
      await runSearch({
        ...claudeOpts,
        searchQuery: "project:claude",
        json: true,
      }),
    ).toBe(0);
    expect(JSON.parse(logs.join("\n")).matches.length).toBeGreaterThan(0);
  });

  it("runSearch rejects invalid redact patterns", async () => {
    expect(
      await runSearch({
        ...claudeOpts,
        searchQuery: "fragment",
        redactPattern: ["("],
      }),
    ).toBe(2);
    expect(errors.join("\n")).toContain("Invalid redact pattern");
  });

  it("runExport writes json to stdout by default", async () => {
    expect(await runExport({ ...claudeOpts, format: "json" })).toBe(0);
    expect(stdoutChunks.join("")).toContain("logsesh.export.v1");
  });

  it("runExport writes markdown to stdout", async () => {
    expect(await runExport({ ...claudeOpts, format: "markdown" })).toBe(0);
    expect(stdoutChunks.join("\n")).toMatch(/^# /m);
  });

  it("runExport rejects invalid format", async () => {
    expect(await runExport({ format: "xml" })).toBe(2);
    expect(errors.join("\n")).toContain("Invalid export format");
  });

  it("runExport rejects summary-only without csv", async () => {
    expect(await runExport({ ...claudeOpts, format: "json", summaryOnly: true })).toBe(2);
    expect(errors.join("\n")).toContain("--summary-only requires --format csv");
  });

  it("runExport writes jsonl to stdout", async () => {
    expect(await runExport({ ...claudeOpts, format: "jsonl" })).toBe(0);
    expect(stdoutChunks.join("")).toContain("logsesh.jsonl.v1");
  });

  it("runExport writes summary csv to stdout", async () => {
    expect(await runExport({ ...claudeOpts, format: "csv", summaryOnly: true })).toBe(0);
    expect(stdoutChunks.join("")).toContain("tool,");
  });

  it("runExport writes json to a file", async () => {
    const dir = join(process.cwd(), `.logsesh-export-${process.pid}`);
    const out = join(dir, "sessions.json");
    try {
      mkdirSync(dir, { recursive: true });
      expect(await runExport({ ...claudeOpts, format: "json", out })).toBe(0);
      expect(readFileSync(out, "utf8")).toContain("logsesh.export.v1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runExport rejects relative output paths outside cwd", async () => {
    expect(await runExport({ ...claudeOpts, format: "json", out: "../logsesh-escape.json" })).toBe(
      2,
    );
    expect(errors.join("\n")).toContain("Refusing to write outside the current directory");
  });

  it("runExport rejects output paths whose real parent escapes cwd through a symlink", async () => {
    const outside = mkdtempSync(join(tmpdir(), "logsesh-export-outside-"));
    const link = join(process.cwd(), `.logsesh-export-link-${process.pid}`);
    try {
      symlinkSync(outside, link, "dir");
      expect(
        await runExport({ ...claudeOpts, format: "json", out: join(link, "sessions.json") }),
      ).toBe(2);
      expect(errors.join("\n")).toContain("Refusing to write outside the current directory");
    } finally {
      rmSync(link, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("runExport rejects final output paths that are symlinks", async () => {
    const dir = join(process.cwd(), `.logsesh-export-symlink-${process.pid}`);
    const target = join(dir, "target.json");
    const out = join(dir, "sessions.json");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(target, "existing");
      symlinkSync(target, out);
      expect(await runExport({ ...claudeOpts, format: "json", out, force: true })).toBe(2);
      expect(errors.join("\n")).toContain("Refusing to write to symlink output path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runExport allows relative output paths inside cwd that start with dot-dot text", async () => {
    const dirName = `..logsesh-export-safe-${process.pid}`;
    const dir = join(process.cwd(), dirName);
    const out = join(dirName, "sessions.json");
    try {
      mkdirSync(dir, { recursive: true });
      expect(await runExport({ ...claudeOpts, format: "json", out })).toBe(0);
      expect(readFileSync(join(process.cwd(), out), "utf8")).toContain("logsesh.export.v1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runExport warns when allow-sensitive is set", async () => {
    expect(await runExport({ ...claudeOpts, format: "json", allowSensitive: true })).toBe(0);
    expect(errors.join("\n")).toContain("--allow-sensitive");
  });

  it("runExport warns when unsafe markdown output is requested", async () => {
    expect(await runExport({ ...claudeOpts, format: "markdown", unsafeRaw: true })).toBe(0);
    expect(errors.join("\n")).toContain("--unsafe-raw disables Markdown injection protection");
  });

  it("runExport rejects invalid redact patterns", async () => {
    expect(await runExport({ ...claudeOpts, format: "json", redactPattern: ["("] })).toBe(2);
    expect(errors.join("\n")).toContain("Invalid redact pattern");
  });

  it("runSearch prints human matches", async () => {
    expect(await runSearch({ ...claudeOpts, searchQuery: "project:claude" })).toBe(0);
    expect(logs.join("\n")).toContain("claude-code");
  });

  it("runDebug returns json envelope for fixture file", async () => {
    const fixture = join(claudeRoot, "fragment-merge.jsonl");
    expect(await runDebug({ file: fixture, json: true })).toBe(0);
    const body = JSON.parse(logs.join("\n"));
    expect(body.format).toBe("logsesh.debug.v1");
    expect(body.session.id).toBe("fragment-merge");
  });
});
