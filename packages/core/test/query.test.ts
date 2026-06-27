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

  it("extracts project field filters", () => {
    const q = parseQuery('project:logsesh auth AND "rate limit"');
    expect(q.fields.project).toEqual(["logsesh"]);
    expect(q.terms).toEqual(["auth"]);
    expect(q.phrases).toEqual(["rate limit"]);
    expect(q.operator).toBe("AND");
    expect(hasTextQuery(q)).toBe(true);
  });

  it("supports quoted project names", () => {
    const q = parseQuery('project:"my app"');
    expect(q.fields.project).toEqual(["my app"]);
    expect(hasTextQuery(q)).toBe(false);
  });

  it("leaves unknown field tokens in text query", () => {
    const q = parseQuery("tool:codex auth");
    expect(q.fields.project).toBeUndefined();
    expect(q.terms).toEqual(["tool:codex", "auth"]);
  });
});
