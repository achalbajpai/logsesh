import { describe, expect, it } from "vitest";
import { matchesProject } from "../src/discovery.js";

describe("matchesProject", () => {
  it("matches exact project path", () => {
    expect(matchesProject("/Users/me/project", "/Users/me/project")).toBe(true);
  });

  it("matches nested project paths by prefix boundary", () => {
    expect(matchesProject("/Users/me/project/app", "/Users/me/project")).toBe(true);
  });

  it("does not match unrelated substring paths", () => {
    expect(matchesProject("/Users/me/project-backup", "/Users/me/project")).toBe(false);
    expect(matchesProject("/tmp/other/project", "/Users/me/project")).toBe(false);
  });

  it("normalizes trailing slashes", () => {
    expect(matchesProject("/Users/me/project/", "/Users/me/project")).toBe(true);
  });

  it("matches project directory names without full paths", () => {
    expect(matchesProject("/Users/me/work/logsesh/src", "logsesh")).toBe(true);
    expect(matchesProject("/Users/me/work/logsesh-backup", "logsesh")).toBe(false);
  });
});
