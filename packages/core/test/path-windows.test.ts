import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeProjectSlugFromPath,
  claudeSubagentFromPath,
  decodeClaudeProjectSlug,
  extractCodexSessionDate,
  isCodexArchivedPath,
  sessionFileNameId,
} from "../src/util.js";

describe("path helpers", () => {
  it("extracts Claude project slugs from posix and Windows paths", () => {
    expect(claudeProjectSlugFromPath("/Users/me/.claude/projects/-Users-me-app/abc.jsonl")).toBe(
      "-Users-me-app",
    );
    expect(
      claudeProjectSlugFromPath("C:\\Users\\me\\.claude\\projects\\-Users-me-app\\abc.jsonl"),
    ).toBe("-Users-me-app");
    expect(claudeProjectSlugFromPath("/tmp/fixtures/real/claude-multi-fragment.jsonl")).toBe(
      "real",
    );
    const ghaWindowsFixture = win32.join(
      "D:\\a\\logsesh\\packages\\core\\test\\fixtures\\real",
      "claude-multi-fragment.jsonl",
    );
    expect(ghaWindowsFixture).toContain("\\");
    expect(claudeProjectSlugFromPath(ghaWindowsFixture)).toBe("real");
    expect(decodeClaudeProjectSlug(claudeProjectSlugFromPath(ghaWindowsFixture))).toBe("real");
  });

  it("extracts Claude subagent identity from nested paths", () => {
    const posix = claudeSubagentFromPath(
      "/Users/me/.claude/projects/slug/parent-id/subagents/agent-abc123.jsonl",
    );
    expect(posix).toEqual({ parentSessionId: "parent-id", agentId: "abc123" });
    const windows = claudeSubagentFromPath(
      "C:\\Users\\me\\.claude\\projects\\slug\\parent-id\\subagents\\agent-abc123.jsonl",
    );
    expect(windows).toEqual({ parentSessionId: "parent-id", agentId: "abc123" });
  });

  it("uses basename for session ids on Windows paths", () => {
    expect(sessionFileNameId("C:\\logs\\rollout-1.jsonl")).toBe("rollout-1");
  });

  it("parses Codex session dates from either separator", () => {
    const posix = extractCodexSessionDate("/Users/me/.codex/sessions/2026/07/02/rollout-x.jsonl");
    const windows = extractCodexSessionDate(
      "C:\\Users\\me\\.codex\\sessions\\2026\\07\\02\\rollout-x.jsonl",
    );
    expect(posix?.toISOString().slice(0, 10)).toBe("2026-07-02");
    expect(windows?.toISOString().slice(0, 10)).toBe("2026-07-02");
    expect(isCodexArchivedPath("C:\\Users\\me\\.codex\\archived_sessions\\rollout-x.jsonl")).toBe(
      true,
    );
  });
});
