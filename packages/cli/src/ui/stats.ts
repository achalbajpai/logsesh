import type { StatsReport, TokenBreakdown, ToolName } from "@logsesh/core";
import type { WriteStream } from "node:tty";
import { barRow, hbar, sparkline, stackedBar, truncateAnsi } from "./charts.js";
import { emptySessionsHint, emptySessionsMessage, renderEmpty } from "./empty.js";
import { describeActiveFilters } from "./filters.js";
import { formatEstimatedCost, formatLoggedCost, formatUnpricedTokens } from "../util/format.js";
import { kvThemed, sectionChrome, termWidth, truncateMiddle } from "./layout.js";
import type { RenderMode } from "./mode.js";
import { humanizeTokens } from "./num.js";
import { type Theme, createTheme } from "./theme.js";

import {
  STATS_DAILY_BURN_NARROW,
  STATS_DAILY_BURN_WIDE,
  STATS_NARROW_WIDTH,
  STATS_PROJECT_LABEL_MIN,
  STATS_PROJECT_LIMIT,
} from "../constants.js";

const SPLIT_KEYS: Array<{
  key: keyof Omit<TokenBreakdown, "observed" | "observedSessionCount">;
  label: string;
}> = [
  { key: "input", label: "input" },
  { key: "output", label: "output" },
  { key: "cacheRead", label: "cache read" },
  { key: "cacheWrite", label: "cache write" },
  { key: "reasoning", label: "reasoning" },
];

function observedCategories(breakdown: TokenBreakdown) {
  return SPLIT_KEYS.filter(({ key }) => breakdown.observed[key]);
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
    return renderEmpty({
      message: emptySessionsMessage(filters),
      hint: emptySessionsHint(filters),
    });
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

function renderSummaryStrip(stats: StatsReport, usedEstimates: boolean, theme: Theme): string[] {
  return kvThemed(
    [
      ["Sessions", String(stats.sessionCount)],
      ["Turns", String(stats.turnCount)],
      ["Tokens", humanizeTokens(stats.totalTokens)],
      ["Logged cost", formatLoggedCost(stats)],
      ["Estimated cost", formatEstimatedCost(stats, usedEstimates)],
    ],
    theme,
  );
}

function renderTokenSplit(stats: StatsReport, width: number, theme: Theme): string[] {
  const breakdown = stats.tokenBreakdown;
  if (!hasObservedSplit(breakdown)) return [];

  const lines: string[] = [theme.label("reported token split")];
  const categories = observedCategories(breakdown);
  const segments = categories.map(({ key }) => ({
    value: breakdown[key],
    paint: theme.split[key],
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
  return width <= STATS_NARROW_WIDTH ? STATS_DAILY_BURN_NARROW : STATS_DAILY_BURN_WIDE;
}

function renderDailyBurn(stats: StatsReport, width: number, theme: Theme): string[] {
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
  theme: Theme,
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

function renderFootnotes(stats: StatsReport, usedEstimates: boolean, theme: Theme): string[] {
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
  const theme = createTheme(mode);
  const width = termWidth(opts.stream ?? process.stdout);

  if (stats.sessionCount === 0) {
    return [
      ...sectionChrome("stats", width, mode, theme),
      ...renderEmpty({
        message: emptySessionsMessage(opts.filters),
        hint: emptySessionsHint(opts.filters),
      }),
    ];
  }

  const lines: string[] = [
    ...sectionChrome("stats", width, mode, theme),
    ...renderSummaryStrip(stats, opts.usedEstimates, theme),
  ];

  const split = renderTokenSplit(stats, width, theme);
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
  const visibleProjects = projectEntries.slice(0, STATS_PROJECT_LIMIT).map(([project, values]) => ({
    label: truncateMiddle(project, Math.max(STATS_PROJECT_LABEL_MIN, 16), mode.unicode),
    tokens: values.tokens,
  }));
  const projectLabelWidth = Math.max(
    STATS_PROJECT_LABEL_MIN,
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
