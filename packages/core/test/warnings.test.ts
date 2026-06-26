import { describe, expect, it } from "vitest";
import { mergeWarnings } from "../src/warnings.js";
import type { Warning } from "../src/types.js";

describe("mergeWarnings", () => {
  it("dedupes identical warnings", () => {
    const target: Warning[] = [];
    const warning: Warning = {
      code: "discovery_permission",
      message: "Permission denied",
      severity: "warn",
      scope: "discovery",
    };
    mergeWarnings(target, [warning, warning]);
    expect(target).toHaveLength(1);
  });
});
