import { describe, expect, it } from "vitest";
import { kv, rule, termWidth, truncateMiddle } from "../../src/ui/layout.js";

describe("termWidth", () => {
  it("preserves real narrow terminal widths and caps wide terminals", () => {
    expect(termWidth({ columns: 40, isTTY: true } as NodeJS.WriteStream)).toBe(40);
    expect(termWidth({ columns: 200, isTTY: true } as NodeJS.WriteStream)).toBe(120);
    expect(termWidth({ columns: 80, isTTY: true } as NodeJS.WriteStream)).toBe(80);
  });

  it("defaults to 80 when columns are missing", () => {
    expect(termWidth({ isTTY: true } as NodeJS.WriteStream)).toBe(80);
  });
});

describe("truncateMiddle", () => {
  it("preserves short strings", () => {
    expect(truncateMiddle("abc", 10)).toBe("abc");
  });

  it("truncates long strings in the middle", () => {
    expect(truncateMiddle("abcdefghijklmnop", 10)).toBe("abcde…mnop");
  });

  it("respects a 12-char project floor use case", () => {
    expect(truncateMiddle("/very/long/project/path", 12)).toBe("/very/…/path");
  });
});

describe("kv", () => {
  it("aligns labels on the colon", () => {
    expect(
      kv([
        ["Sessions", "12"],
        ["Tokens", "1000"],
      ]),
    ).toEqual(["Sessions: 12", "Tokens  : 1000"]);
  });
});

describe("rule", () => {
  it("repeats a character to the requested width", () => {
    expect(rule(5)).toBe("─────");
  });
});
