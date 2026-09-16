import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { antigravityAdapter, antigravityConversationId } from "../src/adapters/antigravity.js";
import {
  modelFromAntigravityText,
  unwrapAntigravityUserText,
} from "../src/adapters/antigravity-events.js";
import {
  encodeAntigravityPlannerPayload,
  encodeAntigravityToolResult,
  encodeAntigravityUserPayload,
} from "../src/adapters/antigravity-sqlite.js";
import { pbEncode, pbStr } from "../src/protobuf-wire.js";
import { inferToolFromPath, sniffToolFromLogLine } from "../src/infer-tool.js";
import type { Session } from "../src/types.js";

const fixtures = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const cliHome = join(fixtures, "antigravity/cli-home");
const conversationId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

async function parseAll(path: string): Promise<Session[]> {
  const sessions: Session[] = [];
  for await (const session of antigravityAdapter.parse({ path, tool: "antigravity" }, {})) {
    sessions.push(session);
  }
  return sessions;
}

function writeConversationDb(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE steps (
      idx INTEGER,
      step_type INTEGER,
      status INTEGER,
      has_subtrajectory numeric,
      metadata BLOB,
      error_details BLOB,
      permissions BLOB,
      task_details BLOB,
      render_info BLOB,
      step_payload BLOB,
      step_format INTEGER
    );
    CREATE TABLE gen_metadata (
      idx INTEGER,
      data BLOB,
      size INTEGER
    );
  `);
  const ts = 1_789_200_000;
  const user = encodeAntigravityUserPayload("ship the search page", ts);
  const planner = encodeAntigravityPlannerPayload({
    text: "I'll list the project.",
    thinking: "Start with the directory.",
    timestampSecs: ts + 1,
    toolCalls: [{ id: "call_1", name: "list_dir", input: { DirectoryPath: "/tmp/app" } }],
  });
  const result = encodeAntigravityToolResult({
    stepType: 9,
    toolUseId: "call_1",
    output: "app.ts",
    timestampSecs: ts + 2,
  });
  const insert = db.prepare(
    "INSERT INTO steps (idx, step_type, status, metadata, error_details, step_payload, step_format) VALUES (?, ?, ?, ?, ?, ?, 0)",
  );
  insert.run(0, 14, 3, Buffer.alloc(0), Buffer.alloc(0), Buffer.from(user));
  insert.run(1, 15, 3, Buffer.alloc(0), Buffer.alloc(0), Buffer.from(planner));
  insert.run(2, 9, 3, Buffer.from(result.metadata), Buffer.alloc(0), Buffer.from(result.payload));
  const modelBlob = pbEncode([{ field: 1, bytes: "using gemini-3.8-flash" }]);
  db.prepare("INSERT INTO gen_metadata (idx, data, size) VALUES (0, ?, ?)").run(
    Buffer.from(modelBlob),
    modelBlob.length,
  );
  db.close();
}

describe("antigravity adapter", () => {
  it("reads conversation ids from Windows transcript paths", () => {
    expect(
      antigravityConversationId(
        "C:\\Users\\me\\.gemini\\antigravity-cli\\brain\\abc-id\\.system_generated\\logs\\transcript_full.jsonl",
      ),
    ).toBe("abc-id");
  });

  it("prefers transcript_full.jsonl over the truncated sibling", async () => {
    const discovered: string[] = [];
    for await (const file of antigravityAdapter.discover({ roots: { antigravity: cliHome } })) {
      discovered.push(file.path);
    }
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.endsWith("transcript_full.jsonl")).toBe(true);
  });

  it("parses transcript steps into turns and tool results", async () => {
    const file = join(
      cliHome,
      "brain",
      conversationId,
      ".system_generated/logs/transcript_full.jsonl",
    );
    const sessions = await parseAll(file);
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.tool).toBe("antigravity");
    expect(session.id).toBe(conversationId);
    expect(session.projectPath).toBe("/tmp/demo-project");
    expect(
      session.turns.some((turn) =>
        turn.content.some((b) => b.kind === "text" && b.text === "fix the login bug"),
      ),
    ).toBe(true);
    const assistant = session.turns.find((turn) => turn.role === "assistant");
    expect(assistant?.toolCalls?.[0]?.name).toBe("view_file");
    expect(assistant?.toolCalls?.[0]?.output).toContain("export function login");
    expect(session.fidelity?.recordsIgnored).toBeGreaterThan(0);
    expect(session.fidelity?.recordsUnknown).toBe(0);
    expect(session.fidelity?.completeness).toBe("complete");
  });

  it("discovers antigravity-acp sqlite conversations and parses protobuf steps", async () => {
    const root = join(tmpdir(), `logsesh-agy-${Date.now()}`);
    const store = join(root, "deadbeef", "antigravity-acp");
    const conversations = join(store, "conversations");
    await mkdir(conversations, { recursive: true });
    const id = "11111111-2222-3333-4444-555555555555";
    const dbPath = join(conversations, `${id}.db`);
    writeConversationDb(dbPath);
    await writeFile(join(conversations, `${id}.meta`), JSON.stringify({ cwd: "/tmp/app" }));

    const discovered: string[] = [];
    for await (const file of antigravityAdapter.discover({ roots: { antigravity: root } })) {
      discovered.push(file.path);
    }
    expect(discovered).toEqual([dbPath]);

    const sessions = await parseAll(dbPath);
    const session = sessions[0]!;
    expect(session.id).toBe(id);
    expect(session.projectPath).toBe("/tmp/app");
    expect(session.model).toBe("gemini-3.8-flash");
    expect(session.source.logFormatVersion).toBe("antigravity-sqlite-protobuf");
    expect(
      session.turns.some((turn) =>
        turn.content.some(
          (block) => block.kind === "text" && block.text === "ship the search page",
        ),
      ),
    ).toBe(true);
    const assistant = session.turns.find((turn) => turn.role === "assistant");
    expect(assistant?.toolCalls?.[0]?.name).toBe("list_dir");
    expect(assistant?.toolCalls?.[0]?.output).toEqual({
      path: "",
      entries: [{ name: "app.ts", isDir: false, sizeBytes: undefined }],
    });
  });
});

describe("antigravity inference", () => {
  it("detects transcript and conversation paths", () => {
    expect(
      inferToolFromPath(
        "/Users/me/.gemini/antigravity-cli/brain/id/.system_generated/logs/transcript.jsonl",
      ),
    ).toBe("antigravity");
    expect(inferToolFromPath("/tmp/store/hash/antigravity-acp/conversations/id.db")).toBe(
      "antigravity",
    );
  });

  it("sniffs transcript lines", () => {
    expect(
      sniffToolFromLogLine(
        '{"step_index":0,"type":"USER_INPUT","content":"<USER_REQUEST>hi</USER_REQUEST>"}',
      ),
    ).toBe("antigravity");
  });
});

describe("protobuf wire", () => {
  it("round-trips a length-delimited string", () => {
    const encoded = pbEncode([{ field: 2, bytes: "hello" }]);
    expect(pbStr(encoded, 2)).toBe("hello");
  });
});

describe("antigravity user envelopes", () => {
  it("strips runtime_info tags and does not keep a trailing model period", () => {
    const raw =
      "hi <runtime_info>In case you're asked: you are running through the Antigravity harness, as gemini-3.8-flash-high. No need to mention this otherwise.</runtime_info>";
    expect(unwrapAntigravityUserText(raw)).toBe("hi");
    expect(modelFromAntigravityText(raw)).toBe("gemini-3.8-flash-high");
  });
});
