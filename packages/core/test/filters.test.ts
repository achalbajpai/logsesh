import { describe, expect, it } from "vitest";
import { sessionToSummary } from "../src/filters.js";
import type { Session } from "../src/types.js";

const session: Session = {
  schemaVersion: "logsesh.session.v1",
  id: "s1",
  source: {
    tool: "claude-code",
    adapterVersion: "0.1.0",
    sourcePath: "/Users/secret/project/session.jsonl",
  },
  tool: "claude-code",
  projectPath: "/Users/secret/project",
  costUsd: null,
  turns: [{ id: "t1", index: 0, role: "user", content: [{ kind: "text", text: "hi" }] }],
};

describe("sessionToSummary", () => {
  it("anonymizes paths by default", () => {
    const summary = sessionToSummary(session);
    expect(summary.projectPath).toBe("~/project");
    expect(summary.sourcePath).toBe("~/project/session.jsonl");
  });

  it("keeps raw paths when rawPaths is true", () => {
    const summary = sessionToSummary(session, { rawPaths: true });
    expect(summary.projectPath).toContain("/Users/secret");
    expect(summary.sourcePath).toContain("/Users/secret");
  });
});
