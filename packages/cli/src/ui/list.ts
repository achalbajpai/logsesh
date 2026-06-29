import type { Estimate, SessionSummary } from "@logsesh/core";
import type { WriteStream } from "node:tty";
import { truncateAnsi } from "./charts.js";
import { humanizeTokens } from "./num.js";
import { padLeft, padRight, rule, termWidth, truncateMiddle } from "./layout.js";
import type { RenderMode } from "./mode.js";
import { createTheme } from "./theme.js";

import { LIST_COL_GAP } from "../constants.js";

function formatDate(iso: string | undefined): string {
  if (!iso) return "-";
  return iso.slice(0, 10);
}

function formatProjectPlain(path: string | undefined, width: number): string {
  const p = path ?? "-";
  if (p.length <= width) return p;
  if (width <= 3) return p.slice(0, width);
  return "..." + p.slice(-(width - 3));
}

function formatCostPlain(costUsd: number | null, estimate?: Estimate): string {
  if (costUsd !== null) return `$${costUsd.toFixed(2)}`;
  if (typeof estimate?.costUsd === "number") return `~$${estimate.costUsd.toFixed(2)} est`;
  return "unknown";
}

function formatCostRich(
  costUsd: number | null,
  estimate: Estimate | undefined,
  theme: ReturnType<typeof createTheme>,
): string {
  if (costUsd !== null) return `$${costUsd.toFixed(2)}`;
  if (typeof estimate?.costUsd === "number")
    return theme.accent(`~$${estimate.costUsd.toFixed(2)} est`);
  return theme.muted("unknown");
}

interface ListRow {
  date: string;
  tool: string;
  project: string;
  turns: string;
  tokens: string;
  costPlain: string;
}

function buildRows(sessions: SessionSummary[]): ListRow[] {
  return sessions.map((session) => ({
    date: formatDate(session.startedAt),
    tool: session.tool,
    project: session.projectPath ?? "-",
    turns: String(session.turnCount),
    tokens: humanizeTokens(session.totalTokens),
    costPlain: formatCostPlain(session.costUsd, session.estimate),
  }));
}

function columnWidths(rows: ListRow[], width: number) {
  const dateW = Math.max(4, "DATE".length, ...rows.map((row) => row.date.length));
  const toolW = Math.max(4, "TOOL".length, ...rows.map((row) => row.tool.length));
  const turnsW = Math.max(5, "TURNS".length, ...rows.map((row) => row.turns.length));
  const tokensW = Math.max(6, "TOKENS".length, ...rows.map((row) => row.tokens.length));
  const costW = Math.max(4, "COST".length, ...rows.map((row) => row.costPlain.length));

  const fixed = dateW + toolW + turnsW + tokensW + costW + LIST_COL_GAP * 5;
  const projectW = Math.max(1, width - fixed);

  return { dateW, toolW, projectW, turnsW, tokensW, costW };
}

function renderPlainTable(sessions: SessionSummary[], width: number): string[] {
  const rows = buildRows(sessions);
  const { dateW, toolW, projectW, turnsW, tokensW, costW } = columnWidths(rows, width);
  const header = ["DATE", "TOOL", truncateMiddle("PROJECT", projectW), "TURNS", "TOKENS", "COST"];
  const widths = [dateW, toolW, projectW, turnsW, tokensW, costW];

  const lines: string[] = [];
  lines.push(header.map((cell, index) => cell.padEnd(widths[index]!)).join("  "));

  for (let i = 0; i < sessions.length; i++) {
    const row = rows[i]!;
    const cells = [
      row.date,
      row.tool,
      formatProjectPlain(row.project, projectW),
      row.turns,
      row.tokens,
      row.costPlain,
    ];
    lines.push(
      cells
        .map((cell, index) =>
          index >= 3 ? padLeft(cell, widths[index]!) : cell.padEnd(widths[index]!),
        )
        .join("  "),
    );
  }

  return lines;
}

function renderRichTable(sessions: SessionSummary[], mode: RenderMode, width: number): string[] {
  const theme = createTheme(mode);
  const rows = buildRows(sessions);
  const { dateW, toolW, projectW, turnsW, tokensW, costW } = columnWidths(rows, width);
  const lines: string[] = [];

  lines.push(
    [
      theme.label(padRight("DATE", dateW)),
      theme.label(padRight("TOOL", toolW)),
      theme.label(padRight(truncateMiddle("PROJECT", projectW), projectW)),
      theme.label(padLeft("TURNS", turnsW)),
      theme.label(padLeft("TOKENS", tokensW)),
      theme.label(padLeft("COST", costW)),
    ].join(" ".repeat(LIST_COL_GAP)),
  );
  lines.push(theme.dim(rule(width)));

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;
    const row = rows[i]!;
    lines.push(
      [
        padRight(row.date, dateW),
        padRight(theme.tool(session.tool, row.tool), toolW),
        padRight(truncateMiddle(row.project, projectW), projectW),
        padLeft(row.turns, turnsW),
        padLeft(row.tokens, tokensW),
        padLeft(formatCostRich(session.costUsd, session.estimate, theme), costW),
      ].join(" ".repeat(LIST_COL_GAP)),
    );
  }

  return lines;
}

export function renderList(
  sessions: SessionSummary[],
  mode: RenderMode,
  opts: { filters: string; stream?: WriteStream },
): string[] {
  if (sessions.length === 0) {
    return [`no sessions matched (${opts.filters})`];
  }

  const width = termWidth(opts.stream ?? process.stdout);
  const lines =
    mode.mode === "plain"
      ? renderPlainTable(sessions, width)
      : renderRichTable(sessions, mode, width);
  return lines.map((line) => truncateAnsi(line, width));
}
