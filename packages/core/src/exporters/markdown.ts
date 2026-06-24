import type { ExportSession, ExportTurn } from "../types.js";
import { neutralizeMarkdown } from "../export-safety.js";

function turnMarkdown(turn: ExportTurn, unsafeRaw: boolean): string {
  const role = turn.role.toUpperCase();
  const lines = turn.content.map((block) => {
    if (block.kind === "text") return neutralizeMarkdown(block.text, unsafeRaw);
    if (block.kind === "thinking") return neutralizeMarkdown(`[thinking] ${block.text}`, unsafeRaw);
    if (block.kind === "image") return `[image: ${block.note ?? "omitted"}]`;
    if (block.kind === "tool_use") return `[tool ${block.name}]`;
    if (block.kind === "tool_result") {
      const out =
        typeof block.output === "string" ? block.output : JSON.stringify(block.output ?? "");
      return neutralizeMarkdown(`[tool result ${block.status ?? "success"}] ${out}`, unsafeRaw);
    }
    return "";
  });
  return `### ${role}\n\n${lines.join("\n\n")}\n`;
}

export function exportSessionMarkdown(session: ExportSession, unsafeRaw = false): string {
  const header = `# Session ${session.id}\n\n- Tool: ${session.tool}\n- Project: ${session.projectPath ?? "unknown"}\n\n`;
  const body = session.turns.map((t) => turnMarkdown(t, unsafeRaw)).join("\n");
  return header + body;
}

export function exportTurnMarkdown(
  turn: ExportTurn,
  session: ExportSession,
  unsafeRaw = false,
): string {
  return `# ${session.id} / turn ${turn.index}\n\n${turnMarkdown(turn, unsafeRaw)}`;
}
