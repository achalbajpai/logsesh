import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { codexAdapter } from "../src/adapters/codex.js";
import { parseFile } from "../src/pipeline.js";
import type { Session } from "../src/types.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/real");

async function parseFixture(tool: "claude-code" | "codex", fileName: string): Promise<Session> {
  const adapter = tool === "claude-code" ? claudeCodeAdapter : codexAdapter;
  const file = join(fixtures, fileName);
  const sessions: Session[] = [];
  for await (const session of adapter.parse({ path: file, tool }, {})) {
    sessions.push(session);
  }
  expect(sessions).toHaveLength(1);
  return sessions[0]!;
}

function normalize(session: Session) {
  return {
    tool: session.tool,
    model: session.model,
    projectPath: session.projectPath,
    usage: session.usage,
    turnCount: session.turns.length,
    roles: session.turns.map((t) => t.role),
    toolCallNames: session.turns.flatMap((t) => (t.toolCalls ?? []).map((c) => c.name)),
    warningCodes: (session.warnings ?? []).map((w) => w.code).sort(),
    contentKinds: session.turns.flatMap((t) => t.content.map((b) => b.kind)),
  };
}

describe("real-log fixture corpus", () => {
  it("claude multi-fragment session uses the final cumulative usage block", async () => {
    const session = await parseFixture("claude-code", "claude-multi-fragment.jsonl");
    expect(session.usage).toMatchObject({
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
    });
    expect(normalize(session)).toMatchSnapshot();
  });

  it("claude retired model row", async () => {
    const session = await parseFixture("claude-code", "claude-retired-model.jsonl");
    expect(session.model).toBe("claude-3-5-sonnet-20241022");
    expect(normalize(session)).toMatchSnapshot();
  });

  it("claude interrupted session with unmatched tool result", async () => {
    const session = await parseFixture("claude-code", "claude-interrupted.jsonl");
    expect(normalize(session)).toMatchSnapshot();
  });

  it("codex session with model_provider and token events", async () => {
    const session = await parseFixture("codex", "codex-model-provider.jsonl");
    expect(session.model).toBe("gpt-5.3-codex");
    expect(session.usage?.totalTokens).toBe(700);
    expect(normalize(session)).toMatchSnapshot();
  });

  it("claude keeps billable model when synthetic lines appear later", async () => {
    const session = await parseFixture("claude-code", "claude-synthetic-overwrite.jsonl");
    expect(session.model).toBe("claude-opus-4-8");
  });

  it("codex resolves model from turn_context when meta only has provider", async () => {
    const session = await parseFixture("codex", "codex-provider-only-meta.jsonl");
    expect(session.model).toBe("gpt-5.5");
    expect(session.usage?.totalTokens).toBe(1200);
  });

  it("codex giant tool output is bounded", async () => {
    const file = join(fixtures, "codex-giant-output.jsonl");
    const session = await parseFile(file, "codex", { maxToolOutputChars: 500 });
    expect(session).not.toBeNull();
    const output = session!.turns
      .flatMap((t) => t.toolCalls ?? [])
      .find((c) => c.name === "shell")?.output;
    expect(typeof output).toBe("string");
    expect((output as string).length).toBeLessThan(1000);
    expect(session!.warnings?.some((w) => w.code === "truncated_tool_output")).toBe(true);
    expect(normalize(session!)).toMatchSnapshot();
  });
});

describe("runDoctor", () => {
  it("reports fixture roots and pricing table", async () => {
    const { runDoctor } = await import("../src/doctor.js");
    const report = await runDoctor({
      roots: {
        "claude-code": join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/claude"),
        codex: join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/codex"),
      },
    });
    expect(report.format).toBe("logsesh.doctor.v1");
    expect(report.pricing.modelCount).toBeGreaterThan(0);
    expect(report.tools.find((t) => t.tool === "claude-code")?.candidateFiles).toBeGreaterThan(0);
    expect(report.tools.every((t) => t.capabilities.model)).toBeTruthy();
  });
});
