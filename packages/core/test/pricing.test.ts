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
    expect(estimate.warnings?.some((w) => w.includes("cost estimate unavailable"))).toBe(true);
    expect(estimate.pricingConfidence).toBe("fallback");
    expect(estimate.costUsd).toBeNull();
    expect(estimate.pricingSourceUrl).toBeTruthy();
  });

  it("returns unknown confidence when no model was parsed", () => {
    const estimate = estimateSessionCost({ ...base, model: undefined });
    expect(estimate.costUsd).toBeNull();
    expect(estimate.pricingConfidence).toBe("unknown");
    expect(estimate.warnings?.some((w) => w.includes("missing model"))).toBe(true);
  });

  it("uses supported OpenAI model rows from pricing data", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "gpt-5.4",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      },
    });
    expect(estimate.costUsd).toBe(17.75);
    expect(estimate.pricingConfidence).toBe("exact");
    expect(estimate.warnings).toBeUndefined();
  });

  it("uses supported GPT-5 model rows from pricing data", () => {
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
    expect(estimate.pricingConfidence).toBe("exact");
    expect(estimate.warnings).toBeUndefined();
  });

  it("keeps officially priced historical rows available for older logs", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "claude-sonnet-4-20250514",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      },
    });
    expect(estimate.costUsd).toBe(21.75);
    expect(estimate.pricingConfidence).toBe("historical");
    expect(estimate.warnings?.some((w) => w.includes("retired model"))).toBe(true);
  });

  it("keeps retired Claude aliases for old log estimates only", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "claude-3-5-sonnet-20241022",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
    });
    expect(estimate.costUsd).toBe(18);
    expect(estimate.pricingConfidence).toBe("historical");
    expect(estimate.warnings?.some((w) => w.includes("retired model"))).toBe(true);
  });

  it("covers heavily used retired Claude 3 generation model ids", () => {
    const cases = [
      { model: "claude-3-opus-20240229", expected: 90 },
      { model: "claude-3-sonnet-20240229", expected: 18 },
      { model: "claude-3-haiku-20240307", expected: 1.5 },
      { model: "claude-3-5-sonnet-20240620", expected: 18 },
      { model: "claude-3-5-sonnet-20241022", expected: 18 },
      { model: "claude-3-7-sonnet-20250219", expected: 18 },
      { model: "claude-3-5-haiku-20241022", expected: 4.8 },
    ];

    for (const item of cases) {
      const estimate = estimateSessionCost({
        ...base,
        model: item.model,
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        },
      });
      expect(estimate.costUsd).toBe(item.expected);
      expect(estimate.pricingConfidence).toBe("historical");
      expect(estimate.warnings?.some((w) => w.includes("retired model"))).toBe(true);
    }
  });

  it("prefers exact aliases over broader prefix aliases", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "gpt-5.4-mini",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      },
    });
    expect(estimate.costUsd).toBe(5.325);
    expect(estimate.pricingConfidence).toBe("exact");
  });

  it("keeps verified older OpenAI rows available", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "gpt-4.1-mini",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      },
    });
    expect(estimate.costUsd).toBe(2.1);
    expect(estimate.pricingConfidence).toBe("exact");
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
    expect(estimate.pricingConfidence).toBe("exact");
    expect(estimate.warnings).toBeUndefined();
  });

  it("warns when a priced model has restricted availability", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "claude-fable-5",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
    });
    expect(estimate.costUsd).toBe(60);
    expect(estimate.pricingConfidence).toBe("exact");
    expect(estimate.warnings?.some((w) => w.includes("restricted availability"))).toBe(true);
  });

  it("includes row-level pricing provenance when matched", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "gpt-5.5",
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    expect(estimate.pricingProvenance).toMatchObject({
      provider: "openai",
      model: "gpt-5.5",
      sourceUrl: "https://platform.openai.com/docs/pricing",
      verifiedAt: "2026-06-27",
      status: "current",
      availability: "available",
    });
    expect(estimate.pricingSourceUrl).toBe("https://platform.openai.com/docs/pricing");
  });

  it("uses retired-model provenance source for historical rows", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "claude-3-opus-20240229",
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    expect(estimate.pricingProvenance?.status).toBe("retired");
    expect(estimate.pricingProvenance?.sourceUrl).toBe(
      "https://platform.claude.com/docs/en/about-claude/model-deprecations",
    );
  });

  it("keeps retired Claude model provenance on the exact canonical row", () => {
    const estimate = estimateSessionCost({
      ...base,
      model: "claude-3-5-sonnet-20241022",
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    expect(estimate.pricingProvenance).toMatchObject({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      effectiveFrom: "2024-10-22",
      status: "retired",
      availability: "retired",
    });
  });
});
