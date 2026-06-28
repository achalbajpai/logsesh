import { describe, expect, it } from "vitest";
import { describeActiveFilters } from "../../src/ui/filters.js";

const ESC = String.fromCharCode(27);

describe("describeActiveFilters", () => {
  it("sanitizes terminal control characters from displayed filter values", () => {
    const filters = describeActiveFilters({
      tool: `codex${ESC}[2J`,
      project: [`demo\nnext`, `${ESC}[31mred${ESC}[0m`],
      query: `auth\tmiddleware${ESC}]0;title${String.fromCharCode(7)}`,
      since: `2026-06-01${ESC}[2J`,
      until: `2026-06-30\nnext`,
    });

    expect(filters).toBe(
      "tool=codex, project=demo next|red, since=2026-06-01, until=2026-06-30 next, query=auth middleware",
    );
  });
});
