import { describe, expect, it } from "vitest";
import { ParseContext } from "../src/parse-context.js";

describe("ParseContext", () => {
  it("marks complete when every observed record is recognized", () => {
    const ctx = new ParseContext({ tool: "codex", sourcePath: "a.jsonl", sessionId: "s1" });
    ctx.observeRecord(10);
    ctx.recognized("message");
    ctx.addBytesParsed(10);
    const fidelity = ctx.finalize();
    expect(fidelity.completeness).toBe("complete");
    expect(fidelity.recordsObserved).toBe(1);
    expect(fidelity.recordsRecognized).toBe(1);
  });

  it("summarizes unknown record types instead of dropping them silently", () => {
    const ctx = new ParseContext({ tool: "claude-code", sourcePath: "a.jsonl" });
    ctx.unknown("server_tool_use");
    ctx.unknown("server_tool_use");
    ctx.unknownContentBlock("mcp_list");
    const warnings = ctx.drainWarnings();
    expect(warnings.some((w) => w.code === "unknown_record_type")).toBe(true);
    expect(warnings.some((w) => w.message.includes('2 "server_tool_use"'))).toBe(true);
    expect(warnings.some((w) => w.code === "unknown_content_block")).toBe(true);
    expect(ctx.finalize().completeness).toBe("partial");
  });
});
