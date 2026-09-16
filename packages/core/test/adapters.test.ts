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
    expect(sessions[0]?.warnings?.some((w) => w.code === "malformed_record")).toBe(true);
  });

  it("warns on unmatched tool result", async () => {
    const file = join(fixtures, "claude/unmatched-result.jsonl");
    const sessions: Session[] = [];
    for await (const s of claudeCodeAdapter.parse({ path: file, tool: "claude-code" }, {})) {
      sessions.push(s);
    }
    expect(sessions[0]?.warnings?.some((w) => w.code === "unmatched_tool_result")).toBe(true);
  });

  it("ignores Claude metadata records such as pr-link and frame-link", async () => {
    const file = join(fixtures, "claude/pr-link.jsonl");
    const sessions: Session[] = [];
    for await (const s of claudeCodeAdapter.parse({ path: file, tool: "claude-code" }, {})) {
      sessions.push(s);
    }
    const session = sessions[0]!;
    expect(session.fidelity?.recordsIgnored).toBe(2);
    expect(session.fidelity?.recordsUnknown).toBe(0);
    expect(session.fidelity?.completeness).toBe("complete");
    expect(session.warnings?.some((w) => w.code === "unknown_record_type")).toBeFalsy();
    expect(
      session.turns.some((t) => t.content.some((b) => b.kind === "text" && b.text === "opened")),
    ).toBe(true);
  });

  it("discovers nested subagent files and reads meta lineage", async () => {
    const root = join(fixtures, "claude/current");
    const discovered: string[] = [];
    for await (const file of claudeCodeAdapter.discover({ roots: { "claude-code": root } })) {
      discovered.push(file.path);
    }
    expect(discovered.some((path) => path.endsWith("parent.jsonl"))).toBe(true);
    expect(discovered.some((path) => path.includes("subagents/agent-abc123.jsonl"))).toBe(true);

    const agent = discovered.find((path) => path.endsWith("agent-abc123.jsonl"))!;
    const sessions: Session[] = [];
    for await (const s of claudeCodeAdapter.parse({ path: agent, tool: "claude-code" }, {})) {
      sessions.push(s);
    }
    const session = sessions[0]!;
    expect(session.id).toBe("abc123");
    expect(session.lineage?.parentSessionId).toBe("parent-session");
    expect(session.lineage?.agentType).toBe("Explore");
    expect(session.lineage?.depth).toBe(1);
    expect(session.branch).toBe("feat/index");
    expect(session.warnings?.some((w) => w.code === "unknown_content_block")).toBe(true);
    expect(session.warnings?.some((w) => w.message.includes("server_tool_use"))).toBe(true);
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

  it("records explicit subagent lineage and cumulative token_usage_record", async () => {
    const file = join(fixtures, "codex/subagents/child.jsonl");
    const sessions: Session[] = [];
    for await (const s of codexAdapter.parse({ path: file, tool: "codex" }, {})) {
      sessions.push(s);
    }
    const session = sessions[0]!;
    expect(session.id).toBe("child-thread");
    expect(session.lineage?.parentSessionId).toBe("parent-thread");
    expect(session.lineage?.agentType).toBe("Explore");
    expect(session.lineage?.depth).toBe(1);
    expect(session.usage?.totalTokens).toBe(25);
    expect(session.fidelity?.completeness).toBe("complete");
  });

  it("marks archived_sessions files as archived", async () => {
    const file = join(fixtures, "codex/archived_sessions/rollout-archived.jsonl");
    const sessions: Session[] = [];
    for await (const s of codexAdapter.parse({ path: file, tool: "codex" }, {})) {
      sessions.push(s);
    }
    expect(sessions[0]?.source.lifecycle).toBe("archived");
    expect(sessions[0]?.id).toBe("archived-1");
  });

  it("pairs tool_search_call with tool_search_output", async () => {
    const file = join(fixtures, "codex/tool-search.jsonl");
    const sessions: Session[] = [];
    for await (const s of codexAdapter.parse({ path: file, tool: "codex" }, {})) {
      sessions.push(s);
    }
    const call = sessions[0]?.turns
      .flatMap((t) => t.toolCalls ?? [])
      .find((c) => c.name === "tool_search");
    expect(call?.id).toBe("call-search-1");
    expect(call?.input).toEqual({ query: "node_repl js", limit: 10 });
    expect(call?.output).toEqual([{ name: "js" }]);
    expect(sessions[0]?.warnings?.some((w) => w.code === "unknown_record_type")).toBeFalsy();
    expect(sessions[0]?.fidelity?.completeness).toBe("complete");
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

  it("reduces current-format events including tool calls", async () => {
    const file = join(fixtures, "gemini/current/basic.jsonl");
    const sessions: Session[] = [];
    for await (const s of geminiAdapter.parse({ path: file, tool: "gemini" }, {})) {
      sessions.push(s);
    }
    const session = sessions[0]!;
    expect(session.id).toBe("gemini-session-1");
    expect(session.model).toBe("gemini-3.8-flash");
    expect(session.turns.some((t) => t.toolCalls?.some((c) => c.name === "list_directory"))).toBe(
      true,
    );
    expect(session.usage?.totalTokens).toBe(15);
    expect(session.fidelity?.completeness).toBe("complete");
    expect(session.warnings?.some((w) => w.code === "unknown_record_type")).toBeFalsy();
  });

  it("applies rewind by dropping the target message and later ones", async () => {
    const file = join(fixtures, "gemini/rewind/basic.jsonl");
    const sessions: Session[] = [];
    for await (const s of geminiAdapter.parse({ path: file, tool: "gemini" }, {})) {
      sessions.push(s);
    }
    const texts = sessions[0]!.turns.flatMap((t) =>
      t.content.filter((b) => b.kind === "text").map((b) => (b.kind === "text" ? b.text : "")),
    );
    expect(texts).toContain("first question");
    expect(texts).toContain("corrected answer");
    expect(texts).not.toContain("wrong answer");
  });

  it("replaces a Gemini message when the same id is written again", async () => {
    const file = join(fixtures, "gemini/current/update.jsonl");
    const sessions: Session[] = [];
    for await (const s of geminiAdapter.parse({ path: file, tool: "gemini" }, {})) {
      sessions.push(s);
    }
    const texts = sessions[0]!.turns.flatMap((t) =>
      t.content.filter((b) => b.kind === "text").map((b) => (b.kind === "text" ? b.text : "")),
    );
    expect(texts).toContain("updated prompt");
    expect(texts).not.toContain("old prompt");
    expect(sessions[0]!.turns.filter((t) => t.role === "user")).toHaveLength(1);
  });
});

describe("adapter discovery", () => {
  it("discovers session files under tmp/<hash>/chats", async () => {
    const root = join(fixtures, "gemini/tmp");
    const discovered: string[] = [];
    for await (const file of geminiAdapter.discover({ roots: { gemini: root } })) {
      discovered.push(file.path);
    }
    expect(discovered.some((path) => path.endsWith("session-current.jsonl"))).toBe(true);
    expect(discovered.some((path) => path.endsWith("session-rewind.jsonl"))).toBe(true);
  });

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
