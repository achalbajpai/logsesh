import type { Estimate, SessionSummary, ToolName, Warning } from "@logsesh/core";
import { anonymizePath, anonymizePathsInText } from "@logsesh/core";
import pc from "picocolors";

const TOOL_NAMES: ToolName[] = ["claude-code", "codex", "gemini"];

export function humanizeTokens(n: number | undefined): string {
  if (n === undefined) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "-";
  return iso.slice(0, 10);
}

export function formatCost(costUsd: number | null, estimate?: Estimate): string {
  if (typeof estimate?.costUsd === "number") {
    return pc.yellow(`~$${estimate.costUsd.toFixed(2)} est`);
  }
  if (costUsd === null) return "unknown";
  return `$${costUsd.toFixed(2)}`;
}

export function formatProject(path: string | undefined, width = 32): string {
  const p = path ?? "-";
  if (p.length <= width) return p;
  return "..." + p.slice(-(width - 1));
}

export function printListTable(sessions: SessionSummary[]): void {
  const header = ["DATE", "TOOL", "PROJECT", "TURNS", "TOKENS", "COST"];
  const rows = sessions.map((s) => [
    formatDate(s.startedAt),
    s.tool,
    formatProject(s.projectPath, 28),
    String(s.turnCount),
    humanizeTokens(s.totalTokens),
    formatCost(s.costUsd, s.estimate),
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)));

  console.log(header.map((h, i) => h.padEnd(widths[i]!)).join("  "));
  for (const row of rows) {
    console.log(row.map((c, i) => c.padEnd(widths[i]!)).join("  "));
  }
}

export function printWarningsToStderr(warnings: Warning[]): void {
  for (const warning of warnings) {
    const message = anonymizePathsInText(warning.message);
    const location = warning.sourcePath ? ` (${anonymizePath(warning.sourcePath)})` : "";
    console.error(`Warning [${warning.code}]: ${message}${location}`);
  }
}

export function parseToolFilter(value: string | undefined): { tools?: ToolName[]; error?: string } {
  if (!value) return {};
  const tools: ToolName[] = [];
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!TOOL_NAMES.includes(trimmed as ToolName)) {
      return {
        error: `Invalid tool "${trimmed}". Expected: ${TOOL_NAMES.join(", ")}`,
      };
    }
    tools.push(trimmed as ToolName);
  }
  return { tools: tools.length > 0 ? tools : undefined };
}

export function parseToolName(value: string): { tool?: ToolName; error?: string } {
  const trimmed = value.trim();
  if (!TOOL_NAMES.includes(trimmed as ToolName)) {
    return {
      error: `Invalid tool "${trimmed}". Expected: ${TOOL_NAMES.join(", ")}`,
    };
  }
  return { tool: trimmed as ToolName };
}

export function parseSinceUntil(
  value: string | undefined,
  label: "since" | "until" = "since",
): { date?: Date; error?: string } {
  if (!value) return {};
  const relative = value.match(/^(\d+)([dhm])$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const ms = unit === "d" ? amount * 86400000 : unit === "h" ? amount * 3600000 : amount * 60000;
    return { date: new Date(Date.now() - ms) };
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return {
      error: `Invalid ${label} date "${value}". Use ISO date or relative (e.g. 7d, 24h, 30m)`,
    };
  }
  return { date: d };
}
