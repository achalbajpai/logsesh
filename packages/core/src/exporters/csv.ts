import type { ExportSession, SessionSummary } from "../types.js";
import { escapeCsvCell } from "../export-safety.js";

export function exportSummaryCsv(sessions: SessionSummary[]): string {
  const header = ["date", "tool", "project", "turns", "tokens", "cost"].join(",");
  const rows = sessions.map((s) => {
    const cost =
      typeof s.estimate?.costUsd === "number"
        ? `~$${s.estimate.costUsd.toFixed(2)} est`
        : s.costUsd === null
          ? "unknown"
          : String(s.costUsd);
    return [
      escapeCsvCell(s.startedAt ?? ""),
      escapeCsvCell(s.tool),
      escapeCsvCell(s.projectPath ?? ""),
      escapeCsvCell(String(s.turnCount)),
      escapeCsvCell(String(s.totalTokens ?? "")),
      escapeCsvCell(cost),
    ].join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

export function exportSessionsCsv(sessions: ExportSession[]): string {
  const header = ["session_id", "tool", "project", "turns", "tokens", "cost"].join(",");
  const rows = sessions.map((s) => {
    const tokens =
      s.usage?.totalTokens ??
      (s.usage ? (s.usage.inputTokens ?? 0) + (s.usage.outputTokens ?? 0) : undefined);
    const cost = s.costUsd === null ? "unknown" : String(s.costUsd);
    return [
      escapeCsvCell(s.id),
      escapeCsvCell(s.tool),
      escapeCsvCell(s.projectPath ?? ""),
      escapeCsvCell(String(s.turns.length)),
      escapeCsvCell(tokens !== undefined ? String(tokens) : ""),
      escapeCsvCell(cost),
    ].join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}
