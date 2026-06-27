import { describe, expect, it } from "vitest";
import { StatsAggregator } from "../src/stats.js";
import type { Session } from "../src/types.js";

const base: Session = {
  schemaVersion: "logsesh.session.v1",
  id: "s1",
  source: { tool: "claude-code", adapterVersion: "0.1.0", sourcePath: "log.jsonl" },
  tool: "claude-code",
  costUsd: null,
  turns: [{ id: "t1", index: 0, role: "user", content: [{ kind: "text", text: "hi" }] }],
  usage: { totalTokens: 1000 },
};

describe("StatsAggregator", () => {
  it("returns null logged and estimated cost when nothing is priced", () => {
    const agg = new StatsAggregator();
    agg.add(base);
    const report = agg.report();
    expect(report.loggedCostUsd).toBeNull();
    expect(report.loggedSessionCount).toBe(0);
    expect(report.estimatedCostUsd).toBeNull();
    expect(report.unpricedSessionCount).toBe(1);
    expect(report.unpricedTokens).toBe(1000);
  });

  it("sums logged session cost separately from estimates", () => {
    const agg = new StatsAggregator();
    agg.add({ ...base, costUsd: 1.25 });
    const report = agg.report();
    expect(report.loggedCostUsd).toBe(1.25);
    expect(report.loggedSessionCount).toBe(1);
    expect(report.estimatedCostUsd).toBeNull();
    expect(report.unpricedSessionCount).toBe(0);
  });

  it("sums estimates only when enabled", () => {
    const agg = new StatsAggregator();
    agg.useEstimates = true;
    agg.add({
      ...base,
      estimate: {
        costUsd: 2.5,
        pricingVersion: "test",
        pricingAsOf: "2026-06-27",
        includesCacheTokens: true,
      },
    });
    const report = agg.report();
    expect(report.loggedCostUsd).toBeNull();
    expect(report.estimatedCostUsd).toBe(2.5);
    expect(report.estimatedSessionCount).toBe(1);
    expect(report.loggedSessionCount).toBe(0);
  });

  it("reports logged session count alongside estimates", () => {
    const agg = new StatsAggregator();
    agg.useEstimates = true;
    agg.add({ ...base, costUsd: 1.25 });
    agg.add({
      ...base,
      id: "s2",
      estimate: {
        costUsd: 2.5,
        pricingVersion: "test",
        pricingAsOf: "2026-06-27",
        includesCacheTokens: true,
      },
    });
    agg.add({ ...base, id: "s3" });
    const report = agg.report();
    expect(report.loggedSessionCount).toBe(1);
    expect(report.estimatedSessionCount).toBe(1);
    expect(report.unpricedSessionCount).toBe(1);
    expect(report.sessionCount).toBe(3);
  });
});
