import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
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
});
