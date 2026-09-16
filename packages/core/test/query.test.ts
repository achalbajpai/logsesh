import { describe, expect, it } from "vitest";
import { hasTextQuery, matchesQuery, parseQuery } from "../src/query.js";

describe("query parser", () => {
  it("defaults to OR", () => {
    expect(parseQuery("foo bar").operator).toBe("OR");
    expect(matchesQuery("foo baz", parseQuery("foo bar"))).toBe(true);
  });

  it("supports AND", () => {
    const q = parseQuery("foo AND bar");
    expect(q.operator).toBe("AND");
    expect(matchesQuery("foo only", q)).toBe(false);
    expect(matchesQuery("foo and bar", q)).toBe(true);
  });

  it("matches quoted phrases", () => {
    const q = parseQuery('"hello world"');
    expect(matchesQuery("say hello world today", q)).toBe(true);
    expect(matchesQuery("hello brave world", q)).toBe(false);
  });

  it("extracts known field filters and leaves unknown fields in text", () => {
    const q = parseQuery('project:logsesh auth AND "rate limit"');
    expect(q.fields.project).toEqual(["logsesh"]);
    expect(q.terms).toEqual(["auth"]);
    expect(q.phrases).toEqual(["rate limit"]);
    expect(q.operator).toBe("AND");
    expect(hasTextQuery(q)).toBe(true);
  });

  it("parses tool, model, agent, parent, branch, and toolcall fields", () => {
    const q = parseQuery(
      "tool:codex model:gpt-5.6 agent:Explore parent:abc branch:feat/x toolcall:Bash auth",
    );
    expect(q.fields.tool).toEqual(["codex"]);
    expect(q.fields.model).toEqual(["gpt-5.6"]);
    expect(q.fields.agent).toEqual(["Explore"]);
    expect(q.fields.parent).toEqual(["abc"]);
    expect(q.fields.branch).toEqual(["feat/x"]);
    expect(q.fields.toolcall).toEqual(["Bash"]);
    expect(q.terms).toEqual(["auth"]);
  });

  it("leaves unknown field tokens in text query", () => {
    const q = parseQuery("foo:codex auth");
    expect(q.fields.project).toBeUndefined();
    expect(q.terms).toEqual(["foo:codex", "auth"]);
  });

  it("supports quoted project names", () => {
    const q = parseQuery('project:"my app"');
    expect(q.fields.project).toEqual(["my app"]);
    expect(hasTextQuery(q)).toBe(false);
  });
});
