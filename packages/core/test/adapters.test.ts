import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { codexAdapter } from "../src/adapters/codex.js";
import { geminiAdapter } from "../src/adapters/gemini.js";
import { getEnabledAdapters, parseRootsOverride } from "../src/adapters/index.js";
import type { Session } from "../src/types.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

describe("claude adapter", () => {
  it("merges fragments by message.id and dedupes usage", async () => {
    const file = join(fixtures, "claude/fragment-merge.jsonl");
    const sessions: Session[] = [];
    for await (const s of claudeCodeAdapter.parse({ path: file, tool: "claude-code" }, {})) {
      sessions.push(s);
    }
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.turns.filter((t) => t.role === "assistant")).toHaveLength(1);
    expect(session.usage?.inputTokens).toBe(10);
    expect(session.model).toBe("claude-sonnet-4-20250514");
    expect(session.costUsd).toBeNull();
  });

  it("dedupes repeated tool_use id across fragments", async () => {
    const file = join(fixtures, "claude/dedupe-tools.jsonl");
    const sessions: Session[] = [];
    for await (const s of claudeCodeAdapter.parse({ path: file, tool: "claude-code" }, {})) {
      sessions.push(s);
    }
    const assistant = sessions[0]!.turns.find((t) => t.role === "assistant");
    expect(assistant?.toolCalls).toHaveLength(1);
  });

  it("warns on malformed line", async () => {
    const file = join(fixtures, "claude/malformed.jsonl");
    const sessions: Session[] = [];
    for await (const s of claudeCodeAdapter.parse({ path: file, tool: "claude-code" }, {})) {
      sessions.push(s);
    }
    expect(sessions[0]?.warnings?.some((w) => w.code === "malformed_line")).toBe(true);
  });

  it("warns on unmatched tool result", async () => {
    const file = join(fixtures, "claude/unmatched-result.jsonl");
    const sessions: Session[] = [];
    for await (const s of claudeCodeAdapter.parse({ path: file, tool: "claude-code" }, {})) {
      sessions.push(s);
    }
    expect(sessions[0]?.warnings?.some((w) => w.code === "unmatched_tool_result")).toBe(true);
  });
});

describe("codex adapter", () => {
  it("uses last token_count total_token_usage with real line shape", async () => {
    const file = join(fixtures, "codex/basic.jsonl");
    const sessions: Session[] = [];
    for await (const s of codexAdapter.parse({ path: file, tool: "codex" }, {})) {
      sessions.push(s);
    }
    expect(sessions[0]?.usage?.totalTokens).toBe(175);
    expect(sessions[0]?.projectPath).toBe("/tmp/project");
    expect(sessions[0]?.model).toBe("gpt-4.1");
  });

  it("does not treat a provider name as the model", async () => {
    const file = join(fixtures, "codex/null-tokens.jsonl");
    const sessions: Session[] = [];
    for await (const s of codexAdapter.parse({ path: file, tool: "codex" }, {})) {
      sessions.push(s);
    }
    expect(sessions[0]?.model).toBeUndefined();
  });

  it("pairs interleaved function_call output by call_id", async () => {
    const file = join(fixtures, "codex/basic.jsonl");
    const sessions: Session[] = [];
    for await (const s of codexAdapter.parse({ path: file, tool: "codex" }, {})) {
      sessions.push(s);
    }
    const call = sessions[0]?.turns
      .flatMap((t) => t.toolCalls ?? [])
      .find((c) => c.id === "call-1");
    expect(call?.output).toBe("ok");
  });

  it("warns when token_count info is null throughout", async () => {
    const file = join(fixtures, "codex/null-tokens.jsonl");
    const sessions: Session[] = [];
    for await (const s of codexAdapter.parse({ path: file, tool: "codex" }, {})) {
      sessions.push(s);
    }
    expect(sessions[0]?.warnings?.some((w) => w.code === "missing_token_usage")).toBe(true);
  });

  it("ignores function_call without string call_id", async () => {
    const file = join(fixtures, "codex/invalid-call-id.jsonl");
    const sessions: Session[] = [];
    for await (const s of codexAdapter.parse({ path: file, tool: "codex" }, {})) {
      sessions.push(s);
    }
    expect(sessions[0]?.turns.flatMap((t) => t.toolCalls ?? [])).toHaveLength(0);
  });
});

describe("gemini adapter", () => {
  it("warns when file exceeds maxFileBytes", async () => {
    const file = join(fixtures, "gemini/basic.jsonl");
    const sessions: Session[] = [];
    for await (const s of geminiAdapter.parse(
      { path: file, tool: "gemini" },
      { maxFileBytes: 1 },
    )) {
      sessions.push(s);
    }
    expect(sessions[0]?.warnings?.some((w) => w.code === "file_too_large")).toBe(true);
  });

  it("captures modelVersion when present", async () => {
    const file = join(fixtures, "gemini/basic.jsonl");
    const sessions: Session[] = [];
    for await (const s of geminiAdapter.parse({ path: file, tool: "gemini" }, {})) {
      sessions.push(s);
    }
    expect(sessions[0]?.model).toBe("gemini-2.5-pro");
  });
});

describe("adapter discovery", () => {
  it("enables tools when custom roots are accessible", async () => {
    const fixtureRoot = join(fixtures, "codex");
    const enabled = await getEnabledAdapters(["codex"], undefined, {
      roots: { codex: fixtureRoot },
    });
    expect(enabled.map((a) => a.tool)).toEqual(["codex"]);
  });
});

describe("parseRootsOverride", () => {
  it("parses valid tool:path specs", () => {
    const { roots, errors } = parseRootsOverride([
      `codex:${join(fixtures, "codex")}`,
      "claude-code:/tmp/claude",
    ]);
    expect(errors).toEqual([]);
    expect(roots.codex).toBe(join(fixtures, "codex"));
    expect(roots["claude-code"]).toBe("/tmp/claude");
  });

  it("reports malformed specs", () => {
    const { roots, errors } = parseRootsOverride(["codex/tmp", "bad:/tmp", "codex:"]);
    expect(Object.keys(roots)).toHaveLength(0);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
