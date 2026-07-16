import type { DoctorReport, DoctorToolReport } from "@logsesh/core";
import { kv, kvThemed, sanitizeInline, sectionChrome, termWidth } from "./layout.js";
import type { RenderMode } from "./mode.js";
import { type Theme, createTheme } from "./theme.js";

type StatusLevel = "ok" | "warn" | "err";

function adapterStatus(tool: DoctorToolReport): { level: StatusLevel; detail: string } {
  if (!tool.rootAccessible) {
    if (tool.permissionIssue) {
      return { level: "err", detail: "permission denied" };
    }
    return { level: "warn", detail: "not detected" };
  }
  if (tool.candidateFiles > 0) {
    const count = `${tool.candidateFilesCapped ? ">=" : ""}${tool.candidateFiles} log file(s)`;
    return { level: "ok", detail: count };
  }
  return { level: "warn", detail: "root readable, no log files found" };
}

function overallHealth(report: DoctorReport): { level: StatusLevel; label: string } {
  const levels = report.tools.map((tool) => adapterStatus(tool).level);
  const hasOk = levels.includes("ok");
  const hasErr = levels.includes("err");
  if (hasErr && !hasOk) return { level: "err", label: "broken" };
  if (hasErr) return { level: "warn", label: "partial" };
  if (hasOk) return { level: "ok", label: "healthy" };
  return { level: "warn", label: "partial" };
}

function hasLogFiles(report: DoctorReport): boolean {
  return report.tools.some((tool) => tool.rootAccessible && tool.candidateFiles > 0);
}

function nextAction(report: DoctorReport): string {
  if (hasLogFiles(report)) {
    return "next: logsesh stats --since 7d --estimate-cost";
  }
  return "next: set --roots tool:path or install Claude Code / Codex / Gemini CLI";
}

function formatStatus(level: StatusLevel, detail: string, mode: RenderMode, theme: Theme): string {
  if (mode.mode === "plain") {
    return `${level} - ${detail}`;
  }

  const label =
    level === "ok" ? theme.ok("ok") : level === "warn" ? theme.warn("warn") : theme.err("err");
  if (!mode.unicode) {
    return `${label} - ${detail}`;
  }

  const glyph = level === "ok" ? " ✓" : level === "warn" ? " !" : " ✗";
  return `${label}${glyph} — ${detail}`;
}

function formatHealthLabel(
  level: StatusLevel,
  label: string,
  mode: RenderMode,
  theme: Theme,
): string {
  if (mode.mode === "plain") return label;
  if (level === "ok") return theme.ok(label);
  if (level === "warn") return theme.warn(label);
  return theme.err(label);
}

function formatCapabilities(tool: DoctorToolReport): string {
  const caps = tool.capabilities;
  return `model=${caps.model}, usage=${caps.usage}, transcript=${caps.transcript}, toolCalls=${caps.toolCalls}, reasoning=${caps.reasoning}`;
}

function formatWarning(
  warning: DoctorReport["warnings"][number],
  mode: RenderMode,
  theme: Theme,
): string {
  const severity =
    mode.mode === "plain"
      ? warning.severity
      : warning.severity === "error"
        ? theme.err(warning.severity)
        : warning.severity === "warn"
          ? theme.warn(warning.severity)
          : theme.muted(warning.severity);
  const details = [
    `${sanitizeInline(warning.scope)}:${sanitizeInline(warning.code)}`,
    sanitizeInline(warning.message),
  ];
  if (warning.sessionId) details.push(`session=${sanitizeInline(warning.sessionId)}`);
  if (typeof warning.line === "number") details.push(`line=${warning.line}`);
  if (warning.cause) details.push(`cause=${sanitizeInline(warning.cause)}`);
  return `${severity}: ${details.join(" ")}`;
}

function sectionHeading(title: string, mode: RenderMode, theme: Theme): string {
  if (mode.mode === "plain") return title;
  return theme.label(title);
}

export function renderDoctor(
  report: DoctorReport,
  mode: RenderMode,
  opts?: { stream?: NodeJS.WriteStream },
): string[] {
  const theme = createTheme(mode);
  const width = termWidth(opts?.stream ?? process.stdout);
  const health = overallHealth(report);
  const lines: string[] = [];

  if (mode.mode === "rich") {
    lines.push(...sectionChrome("doctor", width, mode, theme));
  } else {
    lines.push("doctor");
  }

  const statusValue = formatHealthLabel(health.level, health.label, mode, theme);
  if (mode.mode === "plain") {
    lines.push(`status: ${health.label}`);
  } else {
    lines.push(...kvThemed([["status", statusValue]], theme));
  }

  lines.push("");
  lines.push(sectionHeading("Adapters", mode, theme));

  for (const tool of report.tools) {
    const status = adapterStatus(tool);
    lines.push(`  ${tool.tool}`);
    for (const line of kv([
      ["root", tool.root],
      ["status", formatStatus(status.level, status.detail, mode, theme)],
      ["adapter", tool.adapterVersion],
      ["capabilities", formatCapabilities(tool)],
    ])) {
      lines.push(`    ${line}`);
    }
    if (tool.capabilities.notes?.length) {
      for (const note of tool.capabilities.notes) {
        lines.push(`    note: ${note}`);
      }
    }
  }

  lines.push("");
  lines.push(sectionHeading("Export defaults", mode, theme));
  for (const line of kv([
    [
      "transcript redact",
      report.exportDefaults.transcriptRedactDefault
        ? "on (use --allow-sensitive to opt out)"
        : "off",
    ],
    [
      "summary CSV redact",
      report.exportDefaults.summaryCsvRedactRequired ? "required" : "optional",
    ],
    ["anonymize paths", report.exportDefaults.anonymizePathsDefault ? "on" : "off"],
  ])) {
    lines.push(`  ${line}`);
  }

  lines.push("");
  lines.push(sectionHeading("Pricing table", mode, theme));
  for (const line of kv([
    ["version", report.pricing.version],
    ["as of", report.pricing.asOf],
    ["models", String(report.pricing.modelCount)],
  ])) {
    lines.push(`  ${line}`);
  }
  lines.push("  sources:");
  for (const source of report.pricing.sources) {
    lines.push(`    ${source.provider}: ${source.url} (as of ${source.asOf})`);
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push(sectionHeading("Warnings", mode, theme));
    for (const warning of report.warnings) {
      lines.push(`  ${formatWarning(warning, mode, theme)}`);
    }
  }

  lines.push("");
  lines.push(mode.mode === "plain" ? nextAction(report) : theme.accent(nextAction(report)));

  return lines;
}
