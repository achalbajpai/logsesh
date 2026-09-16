import { describe, expect, it } from "vitest";
import { SessionBuilder } from "../src/session-builder.js";

describe("SessionBuilder", () => {
  it("finalize is idempotent", () => {
    const builder = new SessionBuilder({
      tool: "codex",
      adapterVersion: "0.1.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
    });
    builder.addRecord({
      role: "user",
      sourceLine: 1,
      blocks: [{ kind: "text", text: "hello" }],
    });
    builder.addRecord({
      role: "assistant",
      sourceLine: 2,
      fragmentGroupId: "msg-1",
      blocks: [{ kind: "text", text: "hi" }],
    });

    const first = builder.finalize();
    const second = builder.finalize();
    expect(second).toBe(first);
    expect(second.turns).toHaveLength(first.turns.length);
    expect(second.turns.map((t) => t.index)).toEqual(first.turns.map((t) => t.index));
  });

  it("truncates large object tool outputs", () => {
    const builder = new SessionBuilder({
      tool: "codex",
      adapterVersion: "0.1.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
      maxToolOutputChars: 40,
    });
    builder.addRecord({
      role: "assistant",
      sourceLine: 1,
      fragmentGroupId: "msg-1",
      blocks: [{ kind: "tool_use", id: "call-1", name: "Read", input: {} }],
    });
    builder.addToolResult({
      toolUseId: "call-1",
      sourceLine: 2,
      output: { data: "x".repeat(200) },
    });

    const session = builder.finalize();
    const result = session.turns.find((t) => t.role === "tool");
    const block = result?.content[0];
    expect(block?.kind).toBe("tool_result");
    if (block?.kind !== "tool_result") throw new Error("expected tool_result");
    expect(typeof block.output).toBe("string");
    expect(String(block.output).length).toBeLessThanOrEqual(43);
    expect(session.warnings?.some((w) => w.code === "truncated_tool_output")).toBe(true);
  });

  it("rejects mutation after finalize and keeps cumulative usage from overwriting deltas incorrectly", () => {
    const builder = new SessionBuilder({
      tool: "codex",
      adapterVersion: "0.2.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
    });
    builder.addRecord({
      role: "assistant",
      fragmentGroupId: "a",
      sourceLine: 1,
      blocks: [{ kind: "text", text: "hi" }],
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    });
    builder.observeUsage({
      mode: "cumulative",
      usage: { inputTokens: 40, outputTokens: 8, totalTokens: 48 },
    });
    builder.setModel("gpt-5.3-codex");
    builder.setLineage({ parentSessionId: "parent", agentId: "child" });
    const session = builder.finalize();
    expect(session.usage?.totalTokens).toBe(48);
    expect(session.model).toBe("gpt-5.3-codex");
    expect(session.lineage?.parentSessionId).toBe("parent");
    expect(() => builder.setModel("nope")).toThrow(/finalized/);
  });
});
