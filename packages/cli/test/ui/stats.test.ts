import { describe, expect, it } from "vitest";
import type { StatsReport } from "@logsesh/core";
import { stripAnsi } from "../../src/ui/layout.js";
import { renderStats } from "../../src/ui/stats.js";

const emptyBreakdown: StatsReport["tokenBreakdown"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  observed: {
    input: false,
    output: false,
    cacheRead: false,
    cacheWrite: false,
    reasoning: false,
  },
  observedSessionCount: 0,
};

function baseStats(overrides: Partial<StatsReport> = {}): StatsReport {
  return {
    sessionCount: 2,
    turnCount: 10,
    totalTokens: 5000,
    loggedCostUsd: null,
    loggedSessionCount: 0,
    estimatedCostUsd: null,
    estimatedSessionCount: 0,
    unpricedSessionCount: 2,
    unpricedTokens: 5000,
    byTool: { "claude-code": { sessions: 2, turns: 10, tokens: 5000 } },
    byProject: { "my-project": { sessions: 2, turns: 10, tokens: 5000 } },
    mostActiveDays: [],
    dailyBurn: [{ date: "2026-06-01", sessions: 2, turns: 10, tokens: 5000 }],
    tokenBreakdown: emptyBreakdown,
    ...overrides,
  };
}

const mockStream = { columns: 80, isTTY: true } as NodeJS.WriteStream;

describe("renderStats plain mode", () => {
  it("matches stable flat output", () => {
    const lines = renderStats(
      baseStats(),
      { mode: "plain", color: false, unicode: false },
      { filters: "no filters", usedEstimates: false },
    );
    expect(lines).toContain("Sessions: 2");
    expect(lines).toContain("Tokens: 5000");
    expect(lines).toContain("Logged cost: unknown (local logs have no USD)");
  });

  it("shows empty state with filters", () => {
    const lines = renderStats(
      baseStats({
        sessionCount: 0,
        turnCount: 0,
        totalTokens: 0,
        unpricedSessionCount: 0,
        unpricedTokens: 0,
      }),
      { mode: "plain", color: false, unicode: false },
      { filters: "query=missing", usedEstimates: false },
    );
    expect(lines).toEqual(["no sessions matched (query=missing)"]);
  });

  it("shows unpriced caveats in plain mode", () => {
    const lines = renderStats(
      baseStats(),
      { mode: "plain", color: false, unicode: false },
      { filters: "no filters", usedEstimates: false },
    );
    expect(lines.some((line) => line.includes("Unpriced sessions:"))).toBe(true);
    expect(lines.join("\n")).not.toContain("$0.00");
  });
});

describe("renderStats rich mode", () => {
  it("omits token split when only totalTokens is present", () => {
    const lines = renderStats(
      baseStats(),
      { mode: "rich", color: false, unicode: true },
      { filters: "no filters", usedEstimates: false, stream: mockStream },
    );
    expect(lines.join("\n")).not.toContain("reported token split");
  });

  it("shows observed zero categories in the legend", () => {
    const lines = renderStats(
      baseStats({
        tokenBreakdown: {
          input: 0,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          observed: {
            input: true,
            output: true,
            cacheRead: false,
            cacheWrite: false,
            reasoning: false,
          },
          observedSessionCount: 1,
        },
      }),
      { mode: "rich", color: false, unicode: true },
      { filters: "no filters", usedEstimates: false, stream: mockStream },
    );
    const text = stripAnsi(lines.join("\n"));
    expect(text).toContain("reported token split");
    expect(text).toContain("input 0");
    expect(text).toContain("output 100");
  });

  it("shows coverage label for partial category reporting", () => {
    const lines = renderStats(
      baseStats({
        sessionCount: 3,
        tokenBreakdown: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          observed: {
            input: true,
            output: true,
            cacheRead: false,
            cacheWrite: false,
            reasoning: false,
          },
          observedSessionCount: 2,
        },
      }),
      { mode: "rich", color: false, unicode: true },
      { filters: "no filters", usedEstimates: false, stream: mockStream },
    );
    const coverage = stripAnsi(lines.join("\n"))
      .split("\n")
      .find((line) => line.includes("reported split:"));
    expect(coverage).toBeDefined();
    expect(coverage).toContain("across 2 of 3 sessions");
    expect(coverage).toContain("tracked separately from");
    expect(coverage).not.toMatch(/of \S+ tokens/);
  });

  it("renders daily burn and omits empty charts", () => {
    const lines = renderStats(
      baseStats({ dailyBurn: [] }),
      { mode: "rich", color: false, unicode: true },
      { filters: "no filters", usedEstimates: false, stream: mockStream },
    );
    expect(stripAnsi(lines.join("\n"))).not.toContain("daily burn");
  });

  it("labels estimated cost as approximate in footnotes", () => {
    const lines = renderStats(
      baseStats({
        estimatedCostUsd: 1.23,
        estimatedSessionCount: 1,
        unpricedSessionCount: 1,
      }),
      { mode: "rich", color: false, unicode: true },
      { filters: "no filters", usedEstimates: true, stream: mockStream },
    );
    expect(stripAnsi(lines.join("\n"))).toContain("approximate (~)");
  });
});
