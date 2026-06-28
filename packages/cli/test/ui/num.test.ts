import { describe, expect, it } from "vitest";
import { humanizeTokens, money, padNum, percent } from "../../src/ui/num.js";

describe("humanizeTokens", () => {
  it("returns dash for undefined", () => {
    expect(humanizeTokens(undefined)).toBe("-");
  });

  it("formats billions, millions, and thousands", () => {
    expect(humanizeTokens(7_010_000_000)).toBe("7.01B");
    expect(humanizeTokens(155_690_000)).toBe("155.69M");
    expect(humanizeTokens(45_000)).toBe("45.0k");
  });

  it("promotes values that would round to the next unit", () => {
    expect(humanizeTokens(999_950)).toBe("1.00M");
    expect(humanizeTokens(999_995_000)).toBe("1.00B");
  });

  it("passes through small integers", () => {
    expect(humanizeTokens(42)).toBe("42");
  });
});

describe("money", () => {
  it("formats USD amounts", () => {
    expect(money(12.345)).toBe("$12.35");
    expect(money(12.345, { estimated: true })).toBe("~$12.35");
  });
});

describe("percent", () => {
  it("formats percentages", () => {
    expect(percent(12.345)).toBe("12.3%");
  });
});

describe("padNum", () => {
  it("right-aligns numbers", () => {
    expect(padNum(42, 4)).toBe("  42");
  });
});
