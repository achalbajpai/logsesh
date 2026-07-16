import type { SearchMatch } from "@logsesh/core";
import { parseSearchQuery } from "@logsesh/core";
import type { WriteStream } from "node:tty";
import { formatProject } from "../util/format.js";
import { emptySearchHint, emptySearchMessage, renderEmpty } from "./empty.js";
import {
  rule,
  sanitizeControl,
  sanitizeInline,
  sectionChrome,
  stripAnsi,
  termWidth,
} from "./layout.js";
import type { RenderMode } from "./mode.js";
import { createTheme } from "./theme.js";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchNeedle(queryInput: string): string | null {
  const query = parseSearchQuery(queryInput);
  if (query.terms.length === 0 && query.phrases.length === 0) return null;
  return query.phrases[0] ?? query.terms[0] ?? null;
}

export function highlightSnippet(
  snippet: string,
  needle: string,
  paintMatch: (text: string) => string,
  paintContext: (text: string) => string,
): string {
  if (!needle || snippet.includes("\u001b")) return snippet;

  const pattern = new RegExp(escapeRegex(needle), "gi");
  const parts: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(snippet)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: snippet.slice(lastIndex, match.index), match: false });
    }
    parts.push({ text: match[0], match: true });
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) break;
  }

  if (parts.length === 0) return snippet;
  if (lastIndex < snippet.length) {
    parts.push({ text: snippet.slice(lastIndex), match: false });
  }

  return parts
    .map((part) => (part.match ? paintMatch(part.text) : paintContext(part.text)))
    .join("");
}

function renderMatchHeader(match: SearchMatch, mode: RenderMode): string {
  const toolLabel = sanitizeInline(match.tool);
  const project = formatProject(sanitizeInline(match.projectPath ?? "-"), 28, mode.unicode);
  const timestamp = sanitizeInline(match.timestamp ?? "-");
  const sessionId = sanitizeInline(match.sessionId);
  if (mode.mode === "plain") {
    return `${toolLabel}  ${project}  ${timestamp}  ${sessionId}`;
  }
  const theme = createTheme(mode);
  return `${theme.tool(match.tool, toolLabel)}  ${project}  ${timestamp}  ${sessionId}`;
}

export function renderSearchMatch(
  match: SearchMatch,
  queryInput: string,
  mode: RenderMode,
): string[] {
  const needle = searchNeedle(queryInput);
  const theme = createTheme(mode);
  const lines = [renderMatchHeader(match, mode)];

  for (const rawSnippet of match.snippets) {
    const snippet = sanitizeControl(rawSnippet);
    const body =
      mode.mode === "plain" || !needle
        ? snippet
        : highlightSnippet(snippet, needle, theme.accent, theme.dim);
    lines.push(`  ${body}`);
  }

  return lines;
}

export function renderSearchSeparator(
  mode: RenderMode,
  stream: WriteStream = process.stdout,
): string {
  if (mode.mode === "plain") return "";
  return createTheme(mode).dim(rule(termWidth(stream)));
}

export function renderSearchEmpty(
  filters: string,
  mode: RenderMode,
  opts?: { stream?: WriteStream },
): string[] {
  const empty = renderEmpty({
    message: emptySearchMessage(filters),
    hint: emptySearchHint(),
  });
  if (mode.mode === "plain") return empty;
  const theme = createTheme(mode);
  const width = termWidth(opts?.stream ?? process.stdout);
  return [...sectionChrome("search", width, mode, theme), ...empty];
}

export function renderSearchMatches(
  matches: SearchMatch[],
  queryInput: string,
  mode: RenderMode,
  opts?: { stream?: WriteStream; filters?: string },
): string[] {
  if (matches.length === 0) {
    return renderSearchEmpty(opts?.filters ?? "no filters", mode, opts);
  }

  const width = termWidth(opts?.stream ?? process.stdout);
  const theme = createTheme(mode);
  const lines: string[] =
    mode.mode === "rich" ? [...sectionChrome("search", width, mode, theme)] : [];

  for (let index = 0; index < matches.length; index++) {
    lines.push(...renderSearchMatch(matches[index]!, queryInput, mode));
    if (index < matches.length - 1) {
      const separator = renderSearchSeparator(mode, opts?.stream ?? process.stdout);
      if (separator) lines.push(separator);
      else lines.push("");
    }
  }

  return lines;
}

export function snippetHasAnsi(text: string): boolean {
  return stripAnsi(text) !== text;
}
