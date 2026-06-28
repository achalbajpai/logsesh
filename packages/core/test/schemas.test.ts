import { describe, expect, it } from "vitest";
import {
  doctorEnvelopeSchema,
  listEnvelopeSchema,
  publicSessionSchema,
  sessionSchema,
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

  it("accepts doctor v1 envelopes without pricing sources", () => {
    const envelope = {
      format: "logsesh.doctor.v1" as const,
      generatedAt: new Date().toISOString(),
      tools: [],
      pricing: {
        version: "2026-06-v6",
        asOf: "2026-06-27",
        sourceUrl: "https://platform.openai.com/docs/pricing",
        modelCount: 33,
      },
      exportDefaults: {
        transcriptRedactDefault: true,
        summaryCsvRedactRequired: false,
        anonymizePathsDefault: true,
      },
      warnings: [],
    };
    expect(doctorEnvelopeSchema.parse(envelope).format).toBe("logsesh.doctor.v1");
  });
});
