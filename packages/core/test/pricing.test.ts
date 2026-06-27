import { describe, expect, it } from "vitest";
import { estimateSessionCost } from "../src/pricing.js";
import type { Session } from "../src/types.js";

const base: Session = {
  schemaVersion: "logsesh.session.v1",
  id: "s1",
  source: { tool: "claude-code", adapterVersion: "0.1.0", sourcePath: "log.jsonl" },
  tool: "claude-code",
  model: "claude-sonnet-4-20250514",
  costUsd: null,
  turns: [],
  usage: {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
};

describe("estimateSessionCost", () => {
  it("includes cache-write tokens in the estimate", () => {
    const without = estimateSessionCost(base);
    const withWrite = estimateSessionCost({
      ...base,
      usage: { ...base.usage!, cacheWriteTokens: 1_000_000 },
    });
    expect(withWrite.costUsd).toBeGreaterThan(without.costUsd ?? 0);
    expect(withWrite.includesCacheTokens).toBe(true);
  });

  it("warns when model is unknown", () => {
    const estimate = estimateSessionCost({ ...base, model: "totally-unknown-model-9000" });
    expect(estimate.warnings?.some((w) => w.includes("stale or unknown pricing"))).toBe(true);
    expect(estimate.pricingSourceUrl).toBeTruthy();
  });

  it("uses current OpenAI model rows from pricing data", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "gpt-5.5",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      },
    });
    expect(estimate.costUsd).toBe(35.5);
    expect(estimate.warnings).toBeUndefined();
  });

  it("uses current Claude Opus rows from pricing data", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "claude-opus-4.8",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      },
    });
    expect(estimate.costUsd).toBe(36.25);
    expect(estimate.warnings).toBeUndefined();
  });
});
