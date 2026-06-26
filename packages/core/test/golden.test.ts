import { describe, expect, it } from "vitest";
import { SessionBuilder } from "../src/session-builder.js";

const baseOpts = {
  tool: "claude-code" as const,
  adapterVersion: "0.1.0",
  sourcePath: "/tmp/golden.jsonl",
  sessionId: "golden",
};

describe("golden normalization model", () => {
  it("1. human user text turn", () => {
    const b = new SessionBuilder(baseOpts);
    b.addRecord({ role: "user", sourceLine: 1, blocks: [{ kind: "text", text: "Hello" }] });
    expect(stripVolatile(b.finalize())).toMatchSnapshot();
  });

  it("2. assistant text turn", () => {
    const b = new SessionBuilder(baseOpts);
    b.addRecord({
      role: "assistant",
      fragmentGroupId: "a1",
      sourceLine: 2,
      blocks: [{ kind: "text", text: "Hi there" }],
    });
    expect(stripVolatile(b.finalize())).toMatchSnapshot();
  });

  it("3. assistant tool-call-only turn", () => {
    const b = new SessionBuilder(baseOpts);
    b.addRecord({
      role: "assistant",
      fragmentGroupId: "a2",
      sourceLine: 3,
      blocks: [{ kind: "tool_use", id: "t1", name: "Read", input: { path: "x" } }],
    });
    expect(stripVolatile(b.finalize())).toMatchSnapshot();
  });

  it("4. assistant text + tool calls", () => {
    const b = new SessionBuilder(baseOpts);
    b.addRecord({
      role: "assistant",
      fragmentGroupId: "a3",
      sourceLine: 4,
      blocks: [
        { kind: "text", text: "Let me read that" },
        { kind: "tool_use", id: "t2", name: "Read", input: {} },
      ],
    });
    expect(stripVolatile(b.finalize())).toMatchSnapshot();
  });

  it("5. tool result paired by id", () => {
    const b = new SessionBuilder(baseOpts);
    b.addRecord({
      role: "assistant",
      fragmentGroupId: "a4",
      sourceLine: 5,
      blocks: [{ kind: "tool_use", id: "t3", name: "Bash", input: {} }],
    });
    b.addToolResult({ toolUseId: "t3", sourceLine: 6, output: "ok", status: "success" });
    expect(stripVolatile(b.finalize())).toMatchSnapshot();
  });

  it("6. skipped system role becomes warning via adapter path", () => {
    const b = new SessionBuilder(baseOpts);
    b.addWarning({
      code: "skipped_role",
      message: "Skipped system message",
      severity: "info",
      scope: "parse",
    });
    b.addRecord({ role: "user", sourceLine: 1, blocks: [{ kind: "text", text: "after skip" }] });
    expect(stripVolatile(b.finalize())).toMatchSnapshot();
  });

  it("7. unmatched tool result warns", () => {
    const b = new SessionBuilder(baseOpts);
    b.addToolResult({ toolUseId: "orphan", sourceLine: 2, output: "?", status: "error" });
    expect(stripVolatile(b.finalize())).toMatchSnapshot();
  });
});

function stripVolatile<T extends { turns: { id: string }[] }>(session: T): T {
  return {
    ...session,
    turns: session.turns.map((t, i) => ({ ...t, id: `turn-${i}` })),
  } as T;
}
