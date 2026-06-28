import { describe, expect, it } from "vitest";
import { formatEstimatedCost, formatLoggedCost, formatUnpricedTokens } from "../src/util/format.js";
import type { StatsReport } from "@logsesh/core";

const emptyTokenBreakdown: StatsReport["tokenBreakdown"] = {
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

const emptyStats: StatsReport = {
  sessionCount: 12,
  turnCount: 100,
  totalTokens: 1_000_000,
  loggedCostUsd: null,
  loggedSessionCount: 0,
  estimatedCostUsd: null,
  estimatedSessionCount: 0,
  unpricedSessionCount: 12,
  unpricedTokens: 1_000_000,
  byTool: {},
  byProject: {},
  mostActiveDays: [],
  dailyBurn: [],
  tokenBreakdown: emptyTokenBreakdown,
};

describe("stats cost formatting", () => {
  it("does not show $0.00 logged cost when logs have no USD", () => {
    expect(formatLoggedCost(emptyStats)).toContain("unknown");
    expect(formatLoggedCost(emptyStats)).not.toContain("$0.00");
  });

  it("shows partial estimated totals with session counts", () => {
    const stats: StatsReport = {
      ...emptyStats,
      estimatedCostUsd: 12.34,
      estimatedSessionCount: 2,
      unpricedSessionCount: 10,
      unpricedTokens: 800_000,
    };
    expect(formatEstimatedCost(stats, true)).toBe("~$12.34 est (2/12 sessions priced)");
  });

  it("includes logged sessions in priced session counts", () => {
    const stats: StatsReport = {
      ...emptyStats,
      loggedCostUsd: 5,
      loggedSessionCount: 3,
      estimatedCostUsd: 12.34,
      estimatedSessionCount: 2,
      unpricedSessionCount: 7,
      unpricedTokens: 500_000,
    };
    expect(formatEstimatedCost(stats, true)).toBe("~$12.34 est (5/12 sessions priced)");
  });

  it("shows unpriced token share", () => {
    expect(formatUnpricedTokens(emptyStats)).toBe("1.00M (100.0% of total)");
  });
});
