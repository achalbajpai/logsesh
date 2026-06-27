import { describe, expect, it } from "vitest";
import {
  matchesSessionFilters,
  matchesSessionQuery,
  matchesSessionTextQuery,
} from "../src/discovery.js";
import { parseQuery } from "../src/query.js";
import type { Session } from "../src/types.js";

function session(projectPath: string, text: string): Session {
  return {
    schemaVersion: "logsesh.session.v1",
    id: "s1",
    tool: "claude-code",
    startedAt: "2026-01-01T00:00:00.000Z",
    projectPath,
    costUsd: null,
    turns: [
      {
        id: "t1",
        index: 0,
        role: "user",
        content: [{ kind: "text", text }],
      },
    ],
    source: {
      sourcePath: "/tmp/log.jsonl",
      tool: "claude-code",
      adapterVersion: "test",
    },
  };
}

describe("session query filters", () => {
  it("matches project field and transcript text together", () => {
    const s = session("/Users/me/work/logsesh/app", "debug auth middleware");
    expect(matchesSessionQuery(s, "project:logsesh auth")).toBe(true);
    expect(matchesSessionQuery(s, "project:other auth")).toBe(false);
    expect(matchesSessionQuery(s, "project:logsesh billing")).toBe(false);
  });

  it("matches project-only filters without text terms", () => {
    const s = session("/Users/me/work/logsesh/app", "anything");
    const parsed = parseQuery("project:logsesh");
    expect(matchesSessionFilters(s, parsed)).toBe(true);
    expect(matchesSessionTextQuery(s, parsed)).toBe(true);
    expect(matchesSessionQuery(s, "project:logsesh")).toBe(true);
  });

  it("combines --project with query text", () => {
    const s = session("/Users/me/work/logsesh/app", "debug auth");
    expect(matchesSessionQuery(s, "auth", "logsesh")).toBe(true);
    expect(matchesSessionQuery(s, "billing", "logsesh")).toBe(false);
  });
});
