import { describe, expect, it } from "vitest";
import type { DoctorReport, DoctorToolReport } from "@logsesh/core";
import { stripAnsi } from "../../src/ui/layout.js";
import { renderDoctor } from "../../src/ui/doctor.js";

const baseTool = (overrides: Partial<DoctorToolReport> = {}): DoctorToolReport => ({
  tool: "claude-code",
  detected: true,
  root: "/tmp/claude",
  rootAccessible: true,
  candidateFiles: 5,
  adapterVersion: "0.1.0",
  capabilities: {
    discovery: "full",
    transcript: "full",
    toolCalls: "full",
    usage: "full",
    model: "full",
    reasoning: "partial",
  },
  ...overrides,
});

const sampleReport: DoctorReport = {
  format: "logsesh.doctor.v1",
  generatedAt: "2026-06-28T00:00:00.000Z",
  pricing: {
    version: "2026-06-v6",
    asOf: "2026-06-27",
    sourceUrl: "https://platform.openai.com/docs/pricing",
    sources: [
      { provider: "openai", url: "https://platform.openai.com/docs/pricing", asOf: "2026-06-27" },
    ],
    modelCount: 33,
  },
  exportDefaults: {
    transcriptRedactDefault: true,
    summaryCsvRedactRequired: false,
    anonymizePathsDefault: true,
  },
  tools: [baseTool()],
  warnings: [],
};

function isAscii(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) > 127) return false;
  }
  return true;
}

describe("renderDoctor", () => {
  it("uses mandatory text status labels in plain mode", () => {
    const lines = renderDoctor(sampleReport, { mode: "plain", color: false, unicode: false });
    const statusLine = lines.find((line) => line.includes("status"));
    expect(statusLine).toContain("ok - 5 log file(s)");
    expect(isAscii(statusLine!)).toBe(true);
    expect(statusLine).not.toContain("✓");
  });

  it("adds optional glyphs in rich unicode mode without dropping text labels", () => {
    const lines = renderDoctor(sampleReport, { mode: "rich", color: false, unicode: true });
    const statusLine = lines.find((line) => stripAnsi(line).includes("status"));
    expect(stripAnsi(statusLine!)).toContain("ok ✓ — 5 log file(s)");
  });

  it("labels permission issues as err", () => {
    const report = {
      ...sampleReport,
      tools: [baseTool({ rootAccessible: false, permissionIssue: "EACCES" })],
    };
    const lines = renderDoctor(report, { mode: "plain", color: false, unicode: false });
    expect(lines.some((line) => line.includes("err - permission denied"))).toBe(true);
  });

  it("aligns key/value rows with kv()", () => {
    const lines = renderDoctor(sampleReport, { mode: "plain", color: false, unicode: false });
    expect(lines.some((line) => line.includes("version: 2026-06-v6"))).toBe(true);
    expect(lines.some((line) => line.includes("as of  : 2026-06-27"))).toBe(true);
  });
});
