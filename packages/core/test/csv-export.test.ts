import { describe, expect, it } from "vitest";
import { exportSessionsCsv } from "../src/exporters/csv.js";
import type { PublicSession } from "../src/types.js";

const session = (id: string): PublicSession => ({
  schemaVersion: "logsesh.session.v1",
  id,
  source: { tool: "codex", adapterVersion: "0.1.0", logFormatVersion: "unknown" },
  tool: "codex",
  projectPath: "~/project",
  costUsd: null,
  turns: [{ id: "t1", index: 0, role: "user", content: [{ kind: "text", text: "hi" }] }],
});

describe("exportSessionsCsv", () => {
  it("emits a single header for multiple sessions", () => {
    const csv = exportSessionsCsv([session("a"), session("b")]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line.startsWith("session_id,"))).toHaveLength(1);
  });
});
