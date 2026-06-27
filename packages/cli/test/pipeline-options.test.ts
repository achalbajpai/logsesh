import { describe, expect, it } from "vitest";
import { resolvePipelineOptions } from "../src/util/pipeline-options.js";

describe("resolvePipelineOptions", () => {
  it("rejects invalid tool filter", () => {
    const result = resolvePipelineOptions({ tool: "not-a-tool" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Invalid tool");
  });

  it("rejects invalid since date", () => {
    const result = resolvePipelineOptions({ since: "not-a-date" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Invalid since date");
  });

  it("rejects invalid roots spec", () => {
    const result = resolvePipelineOptions({ roots: ["codex/tmp"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Invalid --roots");
  });

  it("accepts valid pipeline options", () => {
    const result = resolvePipelineOptions({
      tool: "claude-code",
      since: "7d",
      query: "auth",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pipeline.toolFilter).toEqual(["claude-code"]);
      expect(result.pipeline.since).toBeInstanceOf(Date);
      expect(result.pipeline.query).toBe("auth");
    }
  });
});
