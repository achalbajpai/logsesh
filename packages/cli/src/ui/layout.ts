import { TERM_DEFAULT_WIDTH, TERM_MAX_WIDTH } from "../constants.js";
import type { WriteStream } from "node:tty";
import type { RenderMode } from "./mode.js";
import type { Theme } from "./theme.js";

export function termWidth(stream: WriteStream = process.stdout): number {
  const columns = stream.columns ?? TERM_DEFAULT_WIDTH;
  return Math.min(TERM_MAX_WIDTH, columns);
}

export function sectionChrome(
  title: string,
  width: number,
  mode: RenderMode,
  theme: Theme,
): string[] {
  if (mode.mode === "plain") return [title];
  return [theme.label(title), theme.dim(rule(width))];
}

export function rule(width: number, char = "─"): string {
  return char.repeat(width);
}

export function kv(rows: Array<[label: string, value: string]>, labelWidth?: number): string[] {
  const width = labelWidth ?? Math.max(...rows.map(([label]) => label.length), 0);
  return rows.map(([label, value]) => `${label.padEnd(width)}: ${value}`);
}

export function kvThemed(
  rows: Array<[label: string, value: string]>,
  theme: Theme,
  labelWidth?: number,
): string[] {
  const width = labelWidth ?? Math.max(...rows.map(([label]) => label.length), 0);
  return rows.map(
    ([label, value]) => `${theme.label(`${label.padEnd(width)}:`)} ${theme.value(value)}`,
  );
}

export function truncateMiddle(text: string, width: number, unicode = true): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  const ellipsis = unicode ? "…" : "...";
  const ellipsisLen = ellipsis.length;
  if (width <= ellipsisLen) return text.slice(0, width);
  const inner = width - ellipsisLen;
  const head = Math.ceil(inner / 2);
  const tail = Math.floor(inner / 2);
  return `${text.slice(0, head)}${ellipsis}${text.slice(text.length - tail)}`;
}

export function truncateStart(text: string, width: number, unicode = true): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  const ellipsis = unicode ? "…" : "...";
  if (width <= ellipsis.length) return text.slice(0, width);
  return ellipsis + text.slice(-(width - ellipsis.length));
}

export function stripAnsi(text: string): string {
  const esc = String.fromCharCode(27);
  return text.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

export function sanitizeControl(text: string): string {
  const c = String.fromCharCode;
  const esc = c(27);
  const csi = new RegExp(`${esc}\\[[0-9;?]*[ -/]*[@-~]`, "g");
  const osc = new RegExp(`${esc}\\][^${esc}${c(7)}]*(?:${c(7)}|${esc}\\\\)`, "g");
  const twoByte = new RegExp(`${esc}[@-_]`, "g");
  const controls = new RegExp(`[${c(0)}-${c(8)}${c(11)}-${c(31)}${c(127)}-${c(159)}]`, "g");
  return text.replace(csi, "").replace(osc, "").replace(twoByte, "").replace(controls, "");
}

export function sanitizeInline(text: string): string {
  return sanitizeControl(text).replace(/[\t\r\n]+/g, " ");
}

export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

export function padLeft(text: string, width: number): string {
  const pad = width - visibleWidth(text);
  return pad > 0 ? " ".repeat(pad) + text : text;
}

export function padRight(text: string, width: number): string {
  const pad = width - visibleWidth(text);
  return pad > 0 ? text + " ".repeat(pad) : text;
}
