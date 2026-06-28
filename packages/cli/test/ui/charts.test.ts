import { describe, expect, it } from "vitest";
import { barRow, hbar, sparkline, stackedBar } from "../../src/ui/charts.js";
import { stripAnsi, visibleWidth } from "../../src/ui/layout.js";

const ESC = "\u001b";

describe("hbar", () => {
  it("returns empty output for zero value or zero max", () => {
    expect(hbar(0, 10, 8)).toBe("");
    expect(hbar(5, 0, 8)).toBe("");
  });

  it("never exceeds the width budget", () => {
    expect(hbar(10, 10, 8).length).toBeLessThanOrEqual(8);
    expect(hbar(5, 10, 8).length).toBeLessThanOrEqual(8);
  });
});

describe("sparkline", () => {
  it("maps values to spark characters", () => {
    expect(sparkline([1, 2, 3, 4])).toMatch(/^[▁▂▃▄▅▆▇█]+$/);
  });

  it("returns empty output when all values are zero", () => {
    expect(sparkline([0, 0, 0])).toBe("");
  });
});

describe("stackedBar", () => {
  it("allocates proportional segments without exceeding width", () => {
    const bar = stackedBar(
      [
        { value: 50, paint: (text) => text },
        { value: 50, paint: (text) => text },
      ],
      10,
    );
    expect(bar.length).toBe(10);
  });

  it("omits zero-value segments", () => {
    const bar = stackedBar(
      [
        { value: 100, paint: (text) => text },
        { value: 0, paint: (text) => text },
      ],
      8,
    );
    expect(bar).toBe("████████");
  });
});

describe("barRow", () => {
  it("keeps rows within the terminal budget", () => {
    const row = barRow("2026-06-01", "████", "10.0k", 30, 10);
    expect(visibleWidth(row)).toBeLessThanOrEqual(30);
  });

  it("measures colored bars by visible width and never bleeds color", () => {
    const colored = `${ESC}[33m${"█".repeat(60)}${ESC}[39m`;
    const row = barRow("2026-06-21", colored, "404.73M", 80, 10);
    expect(visibleWidth(row)).toBeLessThanOrEqual(80);
    expect(stripAnsi(row).trimEnd().endsWith("404.73M")).toBe(true);
    const codes = row.match(new RegExp(`${ESC}\\[[0-9;]*m`, "g")) ?? [];
    const resets = codes.filter((c) => c === `${ESC}[0m` || c === `${ESC}[39m`);
    const opens = codes.filter((c) => c !== `${ESC}[0m` && c !== `${ESC}[39m`);
    expect(resets.length).toBeGreaterThanOrEqual(opens.length);
  });
});
