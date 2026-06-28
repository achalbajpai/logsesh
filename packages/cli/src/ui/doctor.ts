import type { DoctorReport, DoctorToolReport } from "@logsesh/core";
import { kv, sanitizeInline } from "./layout.js";
import type { RenderMode } from "./mode.js";
import { createTheme } from "./theme.js";

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

function formatStatus(
  level: StatusLevel,
  detail: string,
  mode: RenderMode,
  theme: ReturnType<typeof createTheme>,
): string {
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

function formatCapabilities(tool: DoctorToolReport): string {
  const caps = tool.capabilities;
  return `model=${caps.model}, usage=${caps.usage}, transcript=${caps.transcript}, toolCalls=${caps.toolCalls}, reasoning=${caps.reasoning}`;
}

function formatWarning(
  warning: DoctorReport["warnings"][number],
  mode: RenderMode,
  theme: ReturnType<typeof createTheme>,
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

export function renderDoctor(report: DoctorReport, mode: RenderMode): string[] {
  const theme = createTheme(mode);
  const lines: string[] = [];

  lines.push(heading("Pricing table", mode, theme));
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

  lines.push("");
  lines.push(heading("Export defaults", mode, theme));
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
  lines.push(heading("Adapters", mode, theme));

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

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push(heading("Warnings", mode, theme));
    for (const warning of report.warnings) {
      lines.push(`  ${formatWarning(warning, mode, theme)}`);
    }
  }

  return lines;
}

function heading(title: string, mode: RenderMode, theme: ReturnType<typeof createTheme>): string {
  if (mode.mode === "plain") return title;
  return theme.label(title);
}
