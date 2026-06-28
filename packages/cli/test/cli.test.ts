import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("../../..", import.meta.url)));
const cli = join(root, "packages/cli/dist/index.js");

function run(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

describe("CLI", () => {
  it("debug emits DebugEnvelope JSON", () => {
    const fixture = join(root, "packages/core/test/fixtures/claude/fragment-merge.jsonl");
    const res = run(["debug", fixture, "--json"]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("Warning:");
    expect(JSON.parse(res.stdout).format).toBe("logsesh.debug.v1");
  });

  it("debug auto-detects codex fixtures", () => {
    const fixture = join(root, "packages/core/test/fixtures/codex/basic.jsonl");
    const res = run(["debug", fixture, "--json"]);
    expect(res.status).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.session.tool).toBe("codex");
    expect(body.session.usage?.totalTokens).toBeDefined();
  });

  it("debug warns when --tool mismatches file format", () => {
    const fixture = join(root, "packages/core/test/fixtures/codex/basic.jsonl");
    const res = run(["debug", fixture, "--tool", "claude-code", "--json"]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("expected codex");
  });

  it("export rejects invalid format with exit 2", () => {
    const res = run(["export", "--format", "json1"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Invalid export format");
    expect(res.stdout).toBe("");
  });

  it("search returns exit 1 when no matches in fixture roots", () => {
    const res = run([
      "search",
      "zzzznotfound",
      "--roots",
      `claude-code:${join(root, "packages/core/test/fixtures/claude")}`,
      "--tool",
      "claude-code",
    ]);
    expect(res.status).toBe(1);
  });

  it("JSON export omits sourcePath by default", () => {
    const fixtureRoot = join(root, "packages/core/test/fixtures/claude");
    const res = run([
      "export",
      "--format",
      "json",
      "--roots",
      `claude-code:${fixtureRoot}`,
      "--tool",
      "claude-code",
    ]);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("sourcePath");
  });

  it("--no-anonymize-paths includes sourcePath in JSON export", () => {
    const fixtureRoot = join(root, "packages/core/test/fixtures/claude");
    const res = run([
      "export",
      "--format",
      "json",
      "--no-anonymize-paths",
      "--roots",
      `claude-code:${fixtureRoot}`,
      "--tool",
      "claude-code",
    ]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("sourcePath");
  });

  it("summary CSV anonymizes paths by default", () => {
    const fixtureRoot = join(root, "packages/core/test/fixtures/claude");
    const res = run([
      "export",
      "--format",
      "csv",
      "--summary-only",
      "--roots",
      `claude-code:${fixtureRoot}`,
      "--tool",
      "claude-code",
    ]);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("/Users/");
    expect(res.stdout).toContain("claude-code");
  });

  it("rejects invalid --roots with exit 2", () => {
    const res = run(["list", "--roots", "codex/tmp"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Invalid --roots");
    expect(res.stdout).toBe("");
  });

  it("rejects invalid --tool with exit 2", () => {
    const res = run(["list", "--tool", "not-a-tool"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Invalid tool");
  });

  it("rejects invalid --since with exit 2", () => {
    const res = run(["list", "--since", "not-a-date"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Invalid since date");
  });

  it("prints warnings to stderr in human list mode", () => {
    const fixtureRoot = join(root, "packages/core/test/fixtures/claude");
    const res = run(["list", "--roots", `claude-code:${fixtureRoot}`, "--tool", "claude-code"]);
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/Warning \[/);
    expect(res.stderr).not.toMatch(/\/Users\//);
  });

  it("rejects invalid redact pattern with exit 2", () => {
    const res = run(["search", "hello", "--redact-pattern", "("]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Invalid redact pattern");
  });

  it("doctor emits DoctorEnvelope JSON", () => {
    const fixtureRoot = join(root, "packages/core/test/fixtures/claude");
    const res = run(["doctor", "--json", "--roots", `claude-code:${fixtureRoot}`]);
    expect(res.status).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.format).toBe("logsesh.doctor.v1");
    expect(body.pricing.modelCount).toBeGreaterThan(0);
    expect(body.pricing.sources.length).toBeGreaterThan(1);
    expect(body.tools.some((t: { tool: string }) => t.tool === "claude-code")).toBe(true);
  });

  it("export redacts transcript by default", () => {
    const fixtureRoot = join(root, "packages/core/test/fixtures/claude");
    const res = run([
      "export",
      "--format",
      "json",
      "--roots",
      `claude-code:${fixtureRoot}`,
      "--tool",
      "claude-code",
    ]);
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain("without --redact");
  });

  const claudeFixtureRoot = () => join(root, "packages/core/test/fixtures/claude");
  const claudeRoots = () => [
    "--roots",
    `claude-code:${claudeFixtureRoot()}`,
    "--tool",
    "claude-code",
  ];

  it("list --json emits ListEnvelope with sessions", () => {
    const res = run(["list", "--json", ...claudeRoots()]);
    expect(res.status).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.format).toBe("logsesh.list.v1");
    expect(body.sessions.length).toBeGreaterThan(0);
  });

  it("list --json returns exit 1 when no sessions match", () => {
    const res = run(["list", "--json", "--query", "zzzznotfound", ...claudeRoots()]);
    expect(res.status).toBe(1);
    const body = JSON.parse(res.stdout);
    expect(body.sessions).toHaveLength(0);
  });

  it("list human output returns exit 0 when no sessions match", () => {
    const res = run(["list", "--query", "zzzznotfound", ...claudeRoots()]);
    expect(res.status).toBe(0);
  });

  it("stats --json emits StatsEnvelope", () => {
    const res = run(["stats", "--json", "--estimate-cost", ...claudeRoots()]);
    expect(res.status).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.format).toBe("logsesh.stats.v1");
    expect(body.stats.sessionCount).toBeGreaterThan(0);
  });

  it("stats --json returns exit 1 when no sessions match", () => {
    const res = run(["stats", "--json", "--query", "zzzznotfound", ...claudeRoots()]);
    expect(res.status).toBe(1);
    const body = JSON.parse(res.stdout);
    expect(body.stats.sessionCount).toBe(0);
  });

  it("repeated --project filters are ORed", () => {
    const res = run([
      "list",
      "--json",
      "--project",
      "claude",
      "--project",
      "zzzznotfound",
      ...claudeRoots(),
    ]);
    expect(res.status).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.sessions.length).toBeGreaterThan(0);
  });

  it("export --format markdown writes session markdown", () => {
    const res = run(["export", "--format", "markdown", ...claudeRoots()]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^# /m);
  });

  it("export --format jsonl writes one JSON object per line", () => {
    const res = run(["export", "--format", "jsonl", ...claudeRoots()]);
    expect(res.status).toBe(0);
    const lines = res.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(JSON.parse(line)).toBeTruthy();
    }
  });

  it("export --out refuses overwrite without --force", () => {
    const out = join(root, "packages/cli/test/.tmp-export-test.json");
    const first = run(["export", "--format", "json", "--out", out, ...claudeRoots()]);
    expect(first.status).toBe(0);
    const second = run(["export", "--format", "json", "--out", out, ...claudeRoots()]);
    expect(second.status).toBe(2);
    expect(second.stderr).toContain("Refusing to overwrite");
    run(["export", "--format", "json", "--out", out, "--force", ...claudeRoots()]);
    unlinkSync(out);
  });

  it("export --out rejects relative path escapes", () => {
    const res = run([
      "export",
      "--format",
      "json",
      "--out",
      "../logsesh-escape.json",
      ...claudeRoots(),
    ]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Refusing to write outside the current directory");
  });
});
