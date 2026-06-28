import { describe, expect, it } from "vitest";
import { statsEnvelopeSchema } from "../src/schemas.js";
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

function session(overrides: Partial<Session> = {}): Session {
  return { ...base, ...overrides, id: overrides.id ?? base.id };
}

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

  describe("dailyBurn", () => {
    it("aggregates per-day tokens using sessionTokens logic", () => {
      const agg = new StatsAggregator();
      agg.add(
        session({
          id: "a",
          startedAt: "2026-06-01T10:00:00Z",
          usage: { totalTokens: 500 },
        }),
      );
      agg.add(
        session({
          id: "b",
          startedAt: "2026-06-01T12:00:00Z",
          usage: { inputTokens: 200, outputTokens: 300 },
        }),
      );
      agg.add(
        session({
          id: "c",
          startedAt: "2026-06-02T08:00:00Z",
          usage: { totalTokens: 1000 },
        }),
      );

      expect(agg.report().dailyBurn).toEqual([
        { date: "2026-06-01", sessions: 2, turns: 2, tokens: 1000 },
        { date: "2026-06-02", sessions: 1, turns: 1, tokens: 1000 },
      ]);
    });

    it("uses endedAt when startedAt is missing", () => {
      const agg = new StatsAggregator();
      agg.add(
        session({
          endedAt: "2026-06-03T18:00:00Z",
          usage: { totalTokens: 42 },
        }),
      );
      expect(agg.report().dailyBurn).toEqual([
        { date: "2026-06-03", sessions: 1, turns: 1, tokens: 42 },
      ]);
    });

    it("excludes sessions with no date from dailyBurn but keeps them in totals", () => {
      const agg = new StatsAggregator();
      agg.add(
        session({ id: "dated", startedAt: "2026-06-01T00:00:00Z", usage: { totalTokens: 100 } }),
      );
      agg.add(session({ id: "undated", usage: { totalTokens: 200 } }));

      const report = agg.report();
      expect(report.sessionCount).toBe(2);
      expect(report.totalTokens).toBe(300);
      expect(report.dailyBurn).toEqual([
        { date: "2026-06-01", sessions: 1, turns: 1, tokens: 100 },
      ]);
    });

    it("returns chronological dailyBurn with no gap-filling", () => {
      const agg = new StatsAggregator();
      agg.add(session({ id: "d1", startedAt: "2026-06-01T00:00:00Z", usage: { totalTokens: 10 } }));
      agg.add(session({ id: "d3", startedAt: "2026-06-03T00:00:00Z", usage: { totalTokens: 30 } }));

      expect(agg.report().dailyBurn.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-03"]);
    });
  });

  describe("tokenBreakdown", () => {
    it("does not observe categories when only totalTokens is present", () => {
      const agg = new StatsAggregator();
      agg.add(session({ usage: { totalTokens: 5000 } }));

      const { tokenBreakdown } = agg.report();
      expect(tokenBreakdown.observedSessionCount).toBe(0);
      expect(tokenBreakdown.observed).toEqual({
        input: false,
        output: false,
        cacheRead: false,
        cacheWrite: false,
        reasoning: false,
      });
      expect(tokenBreakdown.input).toBe(0);
    });

    it("treats explicitly present zero values as observed real data", () => {
      const agg = new StatsAggregator();
      agg.add(
        session({
          usage: { inputTokens: 0, outputTokens: 100, totalTokens: 500 },
        }),
      );

      const { tokenBreakdown } = agg.report();
      expect(tokenBreakdown.observed.input).toBe(true);
      expect(tokenBreakdown.input).toBe(0);
      expect(tokenBreakdown.output).toBe(100);
      expect(tokenBreakdown.observedSessionCount).toBe(1);
    });

    it("tracks partial category reporting across sessions", () => {
      const agg = new StatsAggregator();
      agg.add(
        session({
          id: "full",
          usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 },
        }),
      );
      agg.add(
        session({
          id: "partial",
          usage: { inputTokens: 200, outputTokens: 80, totalTokens: 400 },
        }),
      );
      agg.add(session({ id: "total-only", usage: { totalTokens: 1000 } }));

      const { tokenBreakdown, sessionCount, totalTokens } = agg.report();
      expect(sessionCount).toBe(3);
      expect(totalTokens).toBe(1560);
      expect(tokenBreakdown.observedSessionCount).toBe(2);
      expect(tokenBreakdown.observed.cacheRead).toBe(true);
      expect(tokenBreakdown.observed.cacheWrite).toBe(false);
      expect(tokenBreakdown.input).toBe(300);
      expect(tokenBreakdown.output).toBe(130);
      expect(tokenBreakdown.cacheRead).toBe(10);
    });

    it("does not infer split from totalTokens when categories are absent", () => {
      const agg = new StatsAggregator();
      agg.add(session({ usage: { totalTokens: 999, inputTokens: 100 } }));

      const { tokenBreakdown, totalTokens } = agg.report();
      expect(totalTokens).toBe(999);
      expect(tokenBreakdown.input).toBe(100);
      expect(tokenBreakdown.output).toBe(0);
      expect(tokenBreakdown.observed.output).toBe(false);
    });
  });

  it("validates stats envelope with new additive fields", () => {
    const agg = new StatsAggregator();
    agg.add(
      session({ startedAt: "2026-06-01T00:00:00Z", usage: { inputTokens: 10, outputTokens: 5 } }),
    );
    const report = agg.report();

    const envelope = statsEnvelopeSchema.parse({
      format: "logsesh.stats.v1",
      generatedAt: new Date().toISOString(),
      stats: report,
    });

    expect(envelope.stats.dailyBurn).toHaveLength(1);
    expect(envelope.stats.tokenBreakdown).toBeDefined();
    expect(envelope.stats.tokenBreakdown?.observedSessionCount).toBe(1);
  });
});
