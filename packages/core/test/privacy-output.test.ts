import { describe, expect, it } from "vitest";
import { searchSession } from "../src/search.js";
import { StatsAggregator } from "../src/stats.js";
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
  turns: [
    {
      id: "t1",
      index: 0,
      role: "user",
      content: [{ kind: "text", text: "hello function world" }],
    },
  ],
};

describe("privacy in command outputs", () => {
  it("search anonymizes projectPath in matches", () => {
    const match = searchSession(session, "function");
    expect(match?.projectPath).toBe("~/project");
    expect(match?.projectPath).not.toContain("/Users/");
  });

  it("stats anonymizes byProject keys", () => {
    const agg = new StatsAggregator();
    agg.add(session);
    const report = agg.report();
    expect(Object.keys(report.byProject)).toEqual(["~/project"]);
    expect(Object.keys(report.byProject)[0]).not.toContain("/Users/");
  });
});
