import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@logsesh/core";
import { stripAnsi, visibleWidth } from "../../src/ui/layout.js";
import { renderList } from "../../src/ui/list.js";

const sampleSessions: SessionSummary[] = [
  {
    id: "s1",
    tool: "claude-code",
    startedAt: "2026-06-01T10:00:00Z",
    projectPath: "/very/long/project/path/name",
    turnCount: 12,
    totalTokens: 45_000,
    costUsd: null,
    sourcePath: "log.jsonl",
  },
  {
    id: "s2",
    tool: "codex",
    startedAt: "2026-06-02T08:00:00Z",
    projectPath: "my-app",
    turnCount: 3,
    totalTokens: 1200,
    costUsd: 1.25,
    sourcePath: "log2.jsonl",
  },
];

const mockStream = { columns: 80, isTTY: true } as NodeJS.WriteStream;

describe("renderList", () => {
  it("prints empty state with active filters", () => {
    expect(
      renderList(
        [],
        { mode: "plain", color: false, unicode: false },
        { filters: "tool=claude-code" },
      ),
    ).toEqual(["no sessions matched (tool=claude-code)"]);
  });

  it("renders plain table with right-aligned numeric columns", () => {
    const lines = renderList(
      sampleSessions,
      { mode: "plain", color: false, unicode: false },
      { filters: "no filters", stream: mockStream },
    );
    expect(lines[0]).toContain("DATE");
    expect(lines[0]).toContain("TURNS");
    const dataLine = lines[1]!;
    expect(dataLine).toMatch(/\s+12\s+/);
    expect(dataLine).toContain("45.0k");
  });

  it("renders rich table with header rule and no ANSI when color is off", () => {
    const lines = renderList(
      sampleSessions,
      { mode: "rich", color: false, unicode: true },
      { filters: "no filters", stream: mockStream },
    );
    expect(lines[1]).toMatch(/^─+$/);
    expect(lines.some((line) => stripAnsi(line).includes("claude-code"))).toBe(true);
    expect(lines.join("\n")).not.toMatch(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m"));
  });

  it("never sacrifices numeric columns on narrow width", () => {
    const lines = renderList(
      sampleSessions,
      { mode: "plain", color: false, unicode: false },
      { filters: "no filters", stream: { columns: 70, isTTY: true } as NodeJS.WriteStream },
    );
    expect(lines[0]).toContain("TOKENS");
    expect(lines[1]).toContain("45.0k");
  });

  it("shrinks the project column before truncating cost on narrow width", () => {
    const lines = renderList(
      sampleSessions,
      { mode: "plain", color: false, unicode: false },
      { filters: "no filters", stream: { columns: 60, isTTY: true } as NodeJS.WriteStream },
    );

    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    }
    expect(lines[1]).toMatch(/unknown$/);
  });
});
