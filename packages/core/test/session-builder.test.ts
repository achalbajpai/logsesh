import { describe, expect, it } from "vitest";
import { sanitizeForExport } from "../src/sanitize.js";
import type {
  PublicSession,
  RawPathPublicSession,
  RawPathReasoningSession,
  ReasoningSession,
  Session,
} from "../src/types.js";

describe("sanitizeForExport", () => {
  const base: Session = {
    schemaVersion: "logsesh.session.v1",
    id: "s",
    source: {
      tool: "claude-code",
      adapterVersion: "0.1.0",
      sourcePath: "/Users/secret/project/log.jsonl",
    },
    tool: "claude-code",
    projectPath: "/Users/secret/project",
    costUsd: null,
    turns: [
      {
        id: "t1",
        index: 0,
        role: "assistant",
        content: [
          { kind: "text", text: "hi" },
          { kind: "thinking", text: "secret thought" },
        ],
      },
    ],
  };

  it("default strips thinking and anonymizes paths", () => {
    const out = sanitizeForExport(base);
    expect(out.turns[0]?.content).toEqual([{ kind: "text", text: "hi" }]);
    expect(out.projectPath).toBe("~/project");
    expect("sourcePath" in out.source).toBe(false);
  });

  it("rawPaths alone never re-adds reasoning", () => {
    const out = sanitizeForExport(base, { rawPaths: true });
    expect(out.turns[0]?.content).toEqual([{ kind: "text", text: "hi" }]);
    expect(out.projectPath).toContain("/Users/");
  });

  it("includeReasoning adds thinking", () => {
    const out: ReasoningSession = sanitizeForExport(base, { includeReasoning: true });
    expect(out.turns[0]?.content.some((b) => b.kind === "thinking")).toBe(true);
  });

  it("both flags include thinking and raw paths", () => {
    const out: RawPathReasoningSession = sanitizeForExport(base, {
      includeReasoning: true,
      rawPaths: true,
    });
    expect(out.turns[0]?.content.some((b) => b.kind === "thinking")).toBe(true);
    expect(out.projectPath).toContain("/Users/");
  });

  it("type overloads match export variants", () => {
    const pub: PublicSession = sanitizeForExport(base);
    const reasoning: ReasoningSession = sanitizeForExport(base, { includeReasoning: true });
    const raw: RawPathPublicSession = sanitizeForExport(base, { rawPaths: true });
    const rawReasoning: RawPathReasoningSession = sanitizeForExport(base, {
      includeReasoning: true,
      rawPaths: true,
    });
    expect(pub.id).toBe("s");
    expect(reasoning.id).toBe("s");
    expect(raw.id).toBe("s");
    expect(rawReasoning.id).toBe("s");
  });

  it("keeps fidelity and lineage ids and strips warning paths", () => {
    const session: Session = {
      ...base,
      lineage: { agentId: "agent-9", parentSessionId: "parent-1" },
      fidelity: { completeness: "complete", recordsObserved: 2, recordsRecognized: 2 },
      warnings: [
        {
          code: "malformed_line",
          message: "Line 2 in /Users/secret/project/log.jsonl: bad json",
          severity: "warn",
          scope: "parse",
          sourcePath: "/Users/secret/project/log.jsonl",
          sessionId: "s",
        },
      ],
    };
    const out = sanitizeForExport(session);
    expect(out.fidelity?.completeness).toBe("complete");
    expect(out.lineage).toEqual({ agentId: "agent-9", parentSessionId: "parent-1" });
    expect(out.warnings?.[0] && !("sourcePath" in out.warnings[0])).toBe(true);
    expect(JSON.stringify(out.warnings)).not.toContain("/Users/secret");
  });
});
