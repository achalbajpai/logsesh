import type { StatsReport, TokenBreakdown, ToolName } from "@logsesh/core";
import pc from "picocolors";
import type { WriteStream } from "node:tty";
import { barRow, hbar, sparkline, stackedBar, truncateAnsi } from "./charts.js";
import { describeActiveFilters } from "./filters.js";
import { formatEstimatedCost, formatLoggedCost, formatUnpricedTokens } from "../util/format.js";
import { kv, rule, termWidth, truncateMiddle } from "./layout.js";
import type { RenderMode } from "./mode.js";
import { humanizeTokens } from "./num.js";
import { createTheme } from "./theme.js";

const PROJECT_LIMIT = 10;
const DAILY_BURN_WIDE = 30;
const DAILY_BURN_NARROW = 14;
const NARROW_WIDTH = 70;
const PROJECT_LABEL_MIN = 12;

const SPLIT_LABELS: Array<{
  key: keyof Omit<TokenBreakdown, "observed" | "observedSessionCount">;
  label: string;
  paint: (text: string) => string;
}> = [
  { key: "input", label: "input", paint: pc.cyan },
  { key: "output", label: "output", paint: pc.yellow },
  { key: "cacheRead", label: "cache read", paint: pc.blue },
  { key: "cacheWrite", label: "cache write", paint: pc.magenta },
  { key: "reasoning", label: "reasoning", paint: pc.green },
];

function observedCategories(breakdown: TokenBreakdown) {
  return SPLIT_LABELS.filter(({ key }) => breakdown.observed[key]);
}

function hasObservedSplit(breakdown: TokenBreakdown): boolean {
  return observedCategories(breakdown).length > 0;
}

function observedTokenSum(breakdown: TokenBreakdown): number {
  return observedCategories(breakdown).reduce((sum, { key }) => sum + breakdown[key], 0);
}

function splitCoverageLabel(stats: StatsReport): string | null {
  const breakdown = stats.tokenBreakdown;
  if (!hasObservedSplit(breakdown)) return null;
  const observedSum = observedTokenSum(breakdown);
  const partialSessions = breakdown.observedSessionCount < stats.sessionCount;
  const divergentTokens = observedSum !== stats.totalTokens;
  if (!partialSessions && !divergentTokens) return null;
  const base = `reported split: ${humanizeTokens(observedSum)} across ${breakdown.observedSessionCount} of ${stats.sessionCount} sessions`;
  return divergentTokens
    ? `${base} (tracked separately from ${humanizeTokens(stats.totalTokens)} total burn)`
    : base;
}

function renderPlainStats(stats: StatsReport, filters: string, usedEstimates: boolean): string[] {
  if (stats.sessionCount === 0) {
    return [`no sessions matched (${filters})`];
  }

  const lines = [
    `Sessions: ${stats.sessionCount}`,
    `Turns: ${stats.turnCount}`,
    `Tokens: ${stats.totalTokens}`,
    `Logged cost: ${formatLoggedCost(stats)}`,
    `Estimated cost: ${formatEstimatedCost(stats, usedEstimates)}`,
  ];

  if (stats.unpricedSessionCount > 0) {
    lines.push(`Unpriced sessions: ${stats.unpricedSessionCount}`);
    const unpricedTokens = formatUnpricedTokens(stats);
    if (unpricedTokens) lines.push(`Unpriced tokens: ${unpricedTokens}`);
  }

  return lines;
}

function renderSummaryStrip(
  stats: StatsReport,
  usedEstimates: boolean,
  theme: ReturnType<typeof createTheme>,
): string[] {
  return kv([
    ["Sessions", String(stats.sessionCount)],
    ["Turns", String(stats.turnCount)],
    ["Tokens", humanizeTokens(stats.totalTokens)],
    ["Logged cost", formatLoggedCost(stats)],
    ["Estimated cost", formatEstimatedCost(stats, usedEstimates)],
  ]).map((line) => theme.label(line));
}

function renderTokenSplit(
  stats: StatsReport,
  width: number,
  mode: RenderMode,
  theme: ReturnType<typeof createTheme>,
): string[] {
  const breakdown = stats.tokenBreakdown;
  if (!hasObservedSplit(breakdown)) return [];

  const lines: string[] = [theme.label("reported token split")];
  const categories = observedCategories(breakdown);
  const segments = categories.map(({ key, paint }) => ({
    value: breakdown[key],
    paint: mode.color ? paint : (text: string) => text,
  }));

  const bar = stackedBar(segments, width);
  if (bar) lines.push(bar);

  const legend = categories
    .map(({ key, label }) => `${label} ${humanizeTokens(breakdown[key])}`)
    .join("  ");
  lines.push(theme.muted(legend));

  const coverage = splitCoverageLabel(stats);
  if (coverage) lines.push(theme.muted(coverage));

  return lines;
}

function dailyBurnLimit(width: number): number {
  return width <= NARROW_WIDTH ? DAILY_BURN_NARROW : DAILY_BURN_WIDE;
}

function renderDailyBurn(
  stats: StatsReport,
  width: number,
  theme: ReturnType<typeof createTheme>,
): string[] {
  const days = stats.dailyBurn.slice(-dailyBurnLimit(width));
  if (days.length === 0) return [];

  const maxTokens = Math.max(...days.map((day) => day.tokens));
  if (maxTokens <= 0) return [];

  const lines: string[] = [theme.label("daily burn")];
  const labelWidth = 10;
  const valueWidth = Math.max(4, ...days.map((day) => humanizeTokens(day.tokens).length));

  for (const day of days) {
    const bar = theme.accent(hbar(day.tokens, maxTokens, width - labelWidth - valueWidth - 2));
    lines.push(barRow(day.date, bar, humanizeTokens(day.tokens), width, labelWidth));
  }

  if (days.length >= 2) {
    const trend = sparkline(days.map((day) => day.tokens));
    if (trend) {
      lines.push(theme.muted(`${" ".repeat(labelWidth + 1)}${trend}`));
    }
  }

  return lines;
}

function renderRankedBars(
  title: string,
  entries: Array<{ label: string; tokens: number; paint?: (text: string) => string }>,
  width: number,
  theme: ReturnType<typeof createTheme>,
  labelWidth: number,
): string[] {
  if (entries.length === 0) return [];

  const maxTokens = Math.max(...entries.map((entry) => entry.tokens));
  if (maxTokens <= 0) return [];

  const lines: string[] = [theme.label(title)];
  const valueWidth = Math.max(4, ...entries.map((entry) => humanizeTokens(entry.tokens).length));
  const effectiveLabelWidth = Math.max(labelWidth, ...entries.map((entry) => entry.label.length));

  for (const entry of entries) {
    const bar = entry.paint
      ? entry.paint(hbar(entry.tokens, maxTokens, width - effectiveLabelWidth - valueWidth - 2))
      : theme.accent(hbar(entry.tokens, maxTokens, width - effectiveLabelWidth - valueWidth - 2));
    lines.push(barRow(entry.label, bar, humanizeTokens(entry.tokens), width, effectiveLabelWidth));
  }

  return lines;
}

function renderFootnotes(
  stats: StatsReport,
  usedEstimates: boolean,
  theme: ReturnType<typeof createTheme>,
): string[] {
  const lines: string[] = [];

  if (stats.unpricedSessionCount > 0) {
    lines.push(
      theme.muted(
        `unpriced sessions: ${stats.unpricedSessionCount} (${formatUnpricedTokens(stats) ?? "0"} of total tokens)`,
      ),
    );
  }

  if (usedEstimates && stats.estimatedCostUsd !== null) {
    lines.push(theme.muted("estimated cost uses local pricing table; values are approximate (~)"));
  } else if (!usedEstimates && stats.loggedCostUsd === null && stats.unpricedSessionCount > 0) {
    lines.push(
      theme.muted("cost unknown for matched sessions (use --estimate-cost for estimates)"),
    );
  }

  return lines;
}

function renderRichStats(
  stats: StatsReport,
  mode: RenderMode,
  opts: { filters: string; usedEstimates: boolean; stream?: WriteStream },
): string[] {
  if (stats.sessionCount === 0) {
    return [`no sessions matched (${opts.filters})`];
  }

  const theme = createTheme(mode);
  const width = termWidth(opts.stream ?? process.stdout);
  const lines: string[] = [
    theme.label("stats"),
    theme.dim(rule(width)),
    ...renderSummaryStrip(stats, opts.usedEstimates, theme),
  ];

  const split = renderTokenSplit(stats, width, mode, theme);
  if (split.length > 0) {
    lines.push("");
    lines.push(...split);
  }

  const burn = renderDailyBurn(stats, width, theme);
  if (burn.length > 0) {
    lines.push("");
    lines.push(...burn);
  }

  const tools = Object.entries(stats.byTool)
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .map(([tool, values]) => ({
      label: tool,
      tokens: values.tokens,
      paint: (bar: string) => theme.tool(tool as ToolName, bar),
    }));

  const toolLines = renderRankedBars("by tool", tools, width, theme, 11);
  if (toolLines.length > 0) {
    lines.push("");
    lines.push(...toolLines);
  }

  const projectEntries = Object.entries(stats.byProject).sort((a, b) => b[1].tokens - a[1].tokens);
  const visibleProjects = projectEntries.slice(0, PROJECT_LIMIT).map(([project, values]) => ({
    label: truncateMiddle(project, Math.max(PROJECT_LABEL_MIN, 16)),
    tokens: values.tokens,
  }));
  const projectLabelWidth = Math.max(
    PROJECT_LABEL_MIN,
    ...visibleProjects.map((entry) => entry.label.length),
  );
  const projectLines = renderRankedBars(
    "by project",
    visibleProjects,
    width,
    theme,
    projectLabelWidth,
  );
  if (projectLines.length > 0) {
    lines.push("");
    lines.push(...projectLines);
    const remaining = projectEntries.length - visibleProjects.length;
    if (remaining > 0) {
      lines.push(theme.muted(`+${remaining} more`));
    }
  }

  const footnotes = renderFootnotes(stats, opts.usedEstimates, theme);
  if (footnotes.length > 0) {
    lines.push("");
    lines.push(...footnotes);
  }

  return lines.map((line) => truncateAnsi(line, width));
}

export function renderStats(
  stats: StatsReport,
  mode: RenderMode,
  opts: { filters: string; usedEstimates: boolean; stream?: WriteStream },
): string[] {
  if (mode.mode === "plain") {
    return renderPlainStats(stats, opts.filters, opts.usedEstimates);
  }
  return renderRichStats(stats, mode, opts);
}

export function buildStatsFilters(opts: Parameters<typeof describeActiveFilters>[0]): string {
  return describeActiveFilters(opts);
}
