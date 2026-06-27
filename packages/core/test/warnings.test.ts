import { describe, expect, it } from "vitest";
import { mergeWarnings, summarizeWarnings } from "../src/warnings.js";
import type { Warning } from "../src/types.js";

const baseWarning: Warning = {
  code: "discovery_permission",
  message: "Permission denied",
  severity: "warn",
  scope: "discovery",
};

describe("mergeWarnings", () => {
  it("dedupes identical warnings", () => {
    const target: Warning[] = [];
    mergeWarnings(target, [baseWarning, baseWarning]);
    expect(target).toHaveLength(1);
  });
});

describe("summarizeWarnings", () => {
  it("groups repeated warnings from the same file", () => {
    const file = "/Users/secret/.codex/sessions/rollout.jsonl";
    const warnings: Warning[] = Array.from({ length: 5 }, (_, index) => ({
      code: "dropped_encrypted_reasoning",
      message: "Dropped encrypted reasoning blob",
      severity: "info" as const,
      scope: "parse" as const,
      sourcePath: file,
      line: index + 1,
    }));
    const summarized = summarizeWarnings(warnings);
    expect(summarized).toHaveLength(1);
    expect(summarized[0]?.count).toBe(5);
    expect(summarized[0]?.code).toBe("dropped_encrypted_reasoning");
  });

  it("keeps distinct warnings separate", () => {
    const summarized = summarizeWarnings([
      baseWarning,
      {
        ...baseWarning,
        code: "missing_token_usage",
        message: "No usable token_count events found",
      },
    ]);
    expect(summarized).toHaveLength(2);
  });
});
