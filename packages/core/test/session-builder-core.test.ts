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

  it("throws from setters after finalize", () => {
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
    builder.finalize();
    expect(() => builder.setModel("gpt-4.1")).toThrow(/finalize/);
    expect(() => builder.setSessionId("other")).toThrow(/finalize/);
    expect(() => builder.setProjectPath("/tmp")).toThrow(/finalize/);
    expect(() =>
      builder.addRecord({
        role: "user",
        sourceLine: 2,
        blocks: [{ kind: "text", text: "nope" }],
      }),
    ).toThrow(/finalize/);
  });

  it("sums last-write delta usage per fragment group", () => {
    const builder = new SessionBuilder({
      tool: "claude-code",
      adapterVersion: "0.1.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
    });
    builder.addRecord({
      role: "assistant",
      fragmentGroupId: "msg-1",
      sourceLine: 1,
      blocks: [{ kind: "text", text: "a" }],
      usage: { totalTokens: 10 },
    });
    builder.addRecord({
      role: "assistant",
      fragmentGroupId: "msg-1",
      sourceLine: 2,
      blocks: [{ kind: "text", text: "b" }],
      usage: { totalTokens: 15 },
    });
    builder.addRecord({
      role: "assistant",
      fragmentGroupId: "msg-2",
      sourceLine: 3,
      blocks: [{ kind: "text", text: "c" }],
      usage: { totalTokens: 5 },
    });
    expect(builder.finalize().usage?.totalTokens).toBe(20);
  });

  it("keeps the last cumulative usage snapshot", () => {
    const builder = new SessionBuilder({
      tool: "codex",
      adapterVersion: "0.1.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
    });
    builder.observeUsage({ mode: "cumulative", usage: { totalTokens: 10 } });
    builder.observeUsage({ mode: "cumulative", usage: { totalTokens: 40 } });
    expect(builder.finalize().usage?.totalTokens).toBe(40);
  });

  it("warns when usage modes mix and keeps the first mode", () => {
    const builder = new SessionBuilder({
      tool: "codex",
      adapterVersion: "0.1.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
    });
    builder.observeUsage({ mode: "delta", usage: { totalTokens: 3 }, key: "a" });
    builder.observeUsage({ mode: "cumulative", usage: { totalTokens: 99 } });
    const session = builder.finalize();
    expect(session.usage?.totalTokens).toBe(3);
    expect(session.warnings?.some((w) => w.code === "unsupported_usage_shape")).toBe(true);
  });

  it("merges lineage and ignores undefined fields", () => {
    const builder = new SessionBuilder({
      tool: "claude-code",
      adapterVersion: "0.1.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
    });
    builder.setLineage({ agentId: "agent-1" });
    builder.setLineage({ parentSessionId: "parent-1", agentId: undefined });
    builder.addRecord({
      role: "user",
      sourceLine: 1,
      blocks: [{ kind: "text", text: "hi" }],
    });
    const session = builder.finalize();
    expect(session.lineage).toEqual({ agentId: "agent-1", parentSessionId: "parent-1" });
  });

  it("derives fidelity and marks partial when asked", () => {
    const empty = new SessionBuilder({
      tool: "gemini",
      adapterVersion: "0.1.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
    });
    expect(empty.finalize().fidelity?.completeness).toBe("metadata-only");

    const partial = new SessionBuilder({
      tool: "gemini",
      adapterVersion: "0.1.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
    });
    partial.addRecord({
      role: "user",
      sourceLine: 1,
      blocks: [{ kind: "text", text: "hi" }],
    });
    partial.markPartial("context_compacted");
    const session = partial.finalize();
    expect(session.fidelity?.completeness).toBe("partial");
    expect(session.fidelity?.reason).toBe("context_compacted");
  });

  it("elides data URLs and giant base64 without touching English", () => {
    const builder = new SessionBuilder({
      tool: "claude-code",
      adapterVersion: "0.1.0",
      sourcePath: "log.jsonl",
      sessionId: "s1",
    });
    builder.addRecord({
      role: "user",
      sourceLine: 1,
      blocks: [
        { kind: "text", text: "data:image/png;base64,aaaa" },
        { kind: "text", text: "Hello, this is ordinary English." },
        { kind: "text", text: `${"A".repeat(5000)}==` },
      ],
    });
    const content = builder.finalize().turns[0]?.content ?? [];
    expect(content[0]).toMatchObject({
      kind: "image",
      mediaType: "image/png",
      note: "[binary content omitted]",
    });
    expect(content[1]).toEqual({ kind: "text", text: "Hello, this is ordinary English." });
    expect(content[2]).toMatchObject({ kind: "image", note: "[binary content omitted]" });
  });
});
