import { describe, expect, it } from "vitest";
import {
  highlightSnippet,
  renderSearchMatch,
  searchNeedle,
  snippetHasAnsi,
} from "../../src/ui/search.js";
import { sanitizeControl, stripAnsi } from "../../src/ui/layout.js";

const ESC = String.fromCharCode(27);

describe("searchNeedle", () => {
  it("returns text terms for content queries", () => {
    expect(searchNeedle("auth")).toBe("auth");
    expect(searchNeedle("project:myapp auth")).toBe("auth");
  });

  it("returns null for filter-only queries", () => {
    expect(searchNeedle("project:claude")).toBeNull();
  });
});

describe("highlightSnippet", () => {
  const match = (text: string) => `[${text}]`;
  const context = (text: string) => text;

  it("highlights case-insensitively without changing snippet casing", () => {
    const highlighted = highlightSnippet("User Auth failed", "auth", match, context);
    expect(highlighted).toBe("User [Auth] failed");
  });

  it("escapes regex metacharacters in the query", () => {
    const highlighted = highlightSnippet("cost is $1.00", "$1.00", match, context);
    expect(highlighted).toBe("cost is [$1.00]");
  });

  it("skips highlighting when ANSI is already present", () => {
    const snippet = "\u001b[31msecret\u001b[0m value";
    expect(highlightSnippet(snippet, "secret", match, context)).toBe(snippet);
    expect(snippetHasAnsi(snippet)).toBe(true);
  });

  it("returns the original snippet when there is no match", () => {
    expect(highlightSnippet("hello world", "missing", match, context)).toBe("hello world");
  });
});

describe("sanitizeControl", () => {
  it("strips injected ANSI/control sequences but keeps tabs and newlines", () => {
    const injected = `${ESC}[31mred${ESC}[0m\tkept\nline${ESC}]0;title${String.fromCharCode(7)}end${String.fromCharCode(8)}`;
    const out = sanitizeControl(injected);
    expect(out).toBe("red\tkept\nlineend");
    expect(out).not.toMatch(new RegExp(ESC));
  });
});

describe("renderSearchMatch sanitization", () => {
  it("never prints log-provided control sequences, even in plain mode", () => {
    const snippet = `${ESC}[2Jwipe ${ESC}[31mauth${ESC}[0m here`;
    for (const mode of [
      { mode: "plain" as const, color: false, unicode: false },
      { mode: "rich" as const, color: true, unicode: true },
    ]) {
      const lines = renderSearchMatch(
        {
          sessionId: "s1",
          tool: "claude-code",
          projectPath: "demo",
          timestamp: "2026-06-01T00:00:00Z",
          snippets: [snippet],
          totalHits: 1,
        },
        "auth",
        mode,
      );
      const body = lines[1]!;
      expect(body).not.toContain(`${ESC}[2J`);
      expect(body).not.toContain(`${ESC}[31m`);
      expect(stripAnsi(body)).toContain("wipe auth here");
    }
  });
});

describe("renderSearch rich output", () => {
  it("does not emit ANSI in plain mode", async () => {
    const { renderSearchMatches } = await import("../../src/ui/search.js");
    const lines = renderSearchMatches(
      [
        {
          sessionId: "s1",
          tool: "claude-code",
          projectPath: "demo",
          timestamp: "2026-06-01T00:00:00Z",
          snippets: ["User Auth failed"],
          totalHits: 1,
        },
      ],
      "auth",
      { mode: "plain", color: false, unicode: false },
    );
    expect(lines.join("\n")).not.toMatch(new RegExp(String.fromCharCode(27)));
    expect(stripAnsi(lines.join("\n"))).toContain("User Auth failed");
  });
});
