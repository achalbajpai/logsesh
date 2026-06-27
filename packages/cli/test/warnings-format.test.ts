import { describe, expect, it, vi } from "vitest";
import { printWarningsToStderr } from "../src/util/format.js";
import type { Warning } from "@logsesh/core";

describe("printWarningsToStderr", () => {
  it("summarizes repeated warnings into one line", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings: Warning[] = Array.from({ length: 3 }, (_, index) => ({
      code: "dropped_encrypted_reasoning",
      message: "Dropped encrypted reasoning blob",
      severity: "info",
      scope: "parse",
      sourcePath: "/Users/secret/.codex/sessions/rollout.jsonl",
      line: index + 1,
    }));

    printWarningsToStderr(warnings);

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0]?.[0]).toContain("3 occurrences");
    expect(stderr.mock.calls[0]?.[0]).not.toContain("/Users/");
    stderr.mockRestore();
  });
});
