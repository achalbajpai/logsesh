import { describe, expect, it } from "vitest";
import { closeSync, mkdtempSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { inferToolFromPath, resolveDebugTool, sniffToolFromLogLine } from "../src/infer-tool.js";

const fixtures = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

describe("inferToolFromPath", () => {
  it("detects codex rollout paths", () => {
    expect(inferToolFromPath("/Users/me/.codex/sessions/2026/06/rollout-abc.jsonl")).toBe("codex");
    expect(inferToolFromPath("rollout-2026.jsonl")).toBe("codex");
  });

  it("detects claude project paths", () => {
    expect(inferToolFromPath("/Users/me/.claude/projects/-Users-me/foo.jsonl")).toBe("claude-code");
  });

  it("detects gemini chat paths", () => {
    expect(inferToolFromPath("/Users/me/.gemini/tmp/proj/chats/session-1.jsonl")).toBe("gemini");
  });
});

describe("sniffToolFromLogLine", () => {
  it("detects codex lines", () => {
    expect(
      sniffToolFromLogLine(
        '{"type":"session_meta","payload":{"id":"x","cwd":"/tmp","timestamp":"2026-01-01T00:00:00.000Z"}}',
      ),
    ).toBe("codex");
  });

  it("detects claude lines", () => {
    expect(sniffToolFromLogLine('{"type":"user","message":{"role":"user","content":"hi"}}')).toBe(
      "claude-code",
    );
  });

  it("detects gemini lines", () => {
    expect(sniffToolFromLogLine('{"role":"user","parts":[{"text":"hi"}]}')).toBe("gemini");
  });
});

describe("resolveDebugTool", () => {
  it("auto-detects codex fixtures without --tool", () => {
    const file = join(fixtures, "codex/basic.jsonl");
    const resolved = resolveDebugTool(file);
    expect(resolved.tool).toBe("codex");
    expect(resolved.warnings).toHaveLength(0);
  });

  it("warns when explicit tool mismatches file format", () => {
    const file = join(fixtures, "codex/basic.jsonl");
    const resolved = resolveDebugTool(file, "claude-code");
    expect(resolved.tool).toBe("claude-code");
    expect(resolved.warnings[0]).toContain("expected codex");
  });

  it("sniffs tool from first bytes of large files", () => {
    const dir = mkdtempSync(join(tmpdir(), "logsesh-sniff-"));
    const file = join(dir, "rollout-large.jsonl");
    const fd = openSync(file, "w");
    writeSync(fd, Buffer.from('{"type":"session_meta","payload":{"id":"x"}}\n'));
    writeSync(fd, Buffer.alloc(1), 0, 1, 10_000_000);
    closeSync(fd);

    const resolved = resolveDebugTool(file);
    expect(resolved.tool).toBe("codex");
  });
});
