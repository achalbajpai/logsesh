import { describe, expect, it } from "vitest";
import { exportJsonEnvelope, serializeJsonEnvelope } from "../src/exporters/json.js";
import { exportSessionMarkdown, exportTurnMarkdown } from "../src/exporters/markdown.js";
import { exportJsonlRecord, serializeJsonlRecord } from "../src/exporters/jsonl.js";
import type { ExportSession } from "../src/types.js";

const session: ExportSession = {
  schemaVersion: "logsesh.session.v1",
  id: "sess-1",
  tool: "claude-code",
  projectPath: "myapp",
  costUsd: null,
  source: { tool: "claude-code", adapterVersion: "0.1.0", logFormatVersion: "unknown" },
  turns: [
    { id: "t1", index: 0, role: "user", content: [{ kind: "text", text: "hello **world**" }] },
  ],
};

describe("exporters", () => {
  it("builds and serializes json export envelope", () => {
    const envelope = exportJsonEnvelope([session], "session");
    expect(envelope.format).toBe("logsesh.export.v1");
    expect(envelope.records).toHaveLength(1);
    expect(serializeJsonEnvelope(envelope)).toContain("logsesh.export.v1");
  });

  it("renders session and turn markdown safely", () => {
    const sessionMd = exportSessionMarkdown(session);
    expect(sessionMd).toContain("# Session sess-1");
    expect(sessionMd).toContain("hello");

    const injected: ExportSession = {
      ...session,
      turns: [
        {
          id: "t2",
          index: 0,
          role: "user",
          content: [{ kind: "text", text: "<script>x</script>" }],
        },
      ],
    };
    expect(exportSessionMarkdown(injected)).not.toContain("<script>");

    const turnMd = exportTurnMarkdown(session.turns[0]!, session);
    expect(turnMd).toContain("turn 0");
    expect(turnMd).toContain("USER");
  });

  it("serializes jsonl records", () => {
    const record = exportJsonlRecord(session.turns[0]!, []);
    expect(record.format).toBe("logsesh.jsonl.v1");
    expect(JSON.parse(serializeJsonlRecord(record)).record.index).toBe(0);
  });
});
