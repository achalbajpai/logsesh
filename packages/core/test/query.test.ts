import { describe, expect, it } from "vitest";
import { matchesQuery, parseQuery } from "../src/query.js";

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
});
