import { describe, expect, it } from "vitest";
import {
  kv,
  kvThemed,
  rule,
  sectionChrome,
  termWidth,
  truncateMiddle,
  truncateStart,
} from "../../src/ui/layout.js";
import { createTheme } from "../../src/ui/theme.js";

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

describe("truncateStart", () => {
  it("uses ASCII ellipsis in plain and Unicode in rich", () => {
    expect(truncateStart("abcdefghijklmnop", 10, false)).toBe("...jklmnop");
    expect(truncateStart("abcdefghijklmnop", 10, true)).toBe("…hijklmnop");
  });
});

describe("truncateMiddle plain", () => {
  it("uses ASCII ellipsis when unicode is false", () => {
    expect(truncateMiddle("abcdefghijklmnop", 10, false)).toBe("abcd...nop");
  });
});

describe("sectionChrome", () => {
  it("emits title only in plain and title plus rule in rich", () => {
    const mode = { mode: "rich" as const, color: false, unicode: true };
    const theme = createTheme(mode);
    expect(
      sectionChrome("stats", 5, { mode: "plain", color: false, unicode: false }, theme),
    ).toEqual(["stats"]);
    expect(sectionChrome("stats", 5, mode, theme)).toEqual(["stats", "─────"]);
  });
});

describe("kvThemed", () => {
  it("keeps label/value separation", () => {
    const theme = createTheme({ mode: "rich", color: false, unicode: true });
    expect(kvThemed([["Sessions", "12"]], theme)).toEqual(["Sessions: 12"]);
  });
});
