import { describe, expect, it } from "vitest";
import {
  doctorEnvelopeSchema,
  listEnvelopeSchema,
  publicSessionSchema,
  sessionSchema,
  statsEnvelopeSchema,
} from "../src/schemas.js";
import { sanitizeForExport } from "../src/sanitize.js";
import type { Session } from "../src/types.js";

const sampleSession: Session = {
  schemaVersion: "logsesh.session.v1",
  id: "s1",
  source: {
    tool: "claude-code",
    adapterVersion: "0.1.0",
    sourcePath: "/tmp/x.jsonl",
  },
  tool: "claude-code",
  costUsd: null,
  turns: [{ id: "t", index: 0, role: "user", content: [{ kind: "text", text: "hi" }] }],
};

describe("schema validation", () => {
  it("validates session and public session", () => {
    expect(sessionSchema.parse(sampleSession).id).toBe("s1");
    expect(publicSessionSchema.parse(sanitizeForExport(sampleSession)).id).toBe("s1");
  });

  it("validates list envelope", () => {
    const envelope = {
      format: "logsesh.list.v1" as const,
      generatedAt: new Date().toISOString(),
      sessions: [],
      warnings: [],
    };
    expect(listEnvelopeSchema.parse(envelope).format).toBe("logsesh.list.v1");
  });

  it("requires doctor pricing sources", () => {
    const envelope = {
      format: "logsesh.doctor.v1" as const,
      generatedAt: new Date().toISOString(),
      tools: [],
      pricing: {
        version: "2026-06-v6",
        asOf: "2026-06-27",
        sourceUrl: "https://platform.openai.com/docs/pricing",
        sources: [
          {
            provider: "openai",
            url: "https://platform.openai.com/docs/pricing",
            asOf: "2026-06-27",
          },
        ],
        modelCount: 33,
      },
      exportDefaults: {
        transcriptRedactDefault: true,
        summaryCsvRedactRequired: false,
        anonymizePathsDefault: true,
      },
      warnings: [],
    };
    const parsed = doctorEnvelopeSchema.parse(envelope);
    expect(parsed.pricing.sources).toHaveLength(1);
  });

  it("requires current stats v1 additive fields", () => {
    const envelope = {
      format: "logsesh.stats.v1" as const,
      generatedAt: new Date().toISOString(),
      stats: {
        sessionCount: 0,
        turnCount: 0,
        totalTokens: 0,
        loggedCostUsd: null,
        loggedSessionCount: 0,
        estimatedCostUsd: null,
        estimatedSessionCount: 0,
        unpricedSessionCount: 0,
        unpricedTokens: 0,
        byTool: {},
        byProject: {},
        mostActiveDays: [],
        dailyBurn: [],
        tokenBreakdown: {
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
        },
      },
      warnings: [],
    };

    const parsed = statsEnvelopeSchema.parse(envelope);
    expect(parsed.stats.tokenBreakdown.observedSessionCount).toBe(0);
  });
});
