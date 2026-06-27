import type { SearchMatch, Session, Turn } from "./types.js";
import { matchesSessionFilters } from "./discovery.js";
import { hasTextQuery, matchesQuery, parseQuery, textOnlyQuery } from "./query.js";
import { redactText } from "./redact.js";
import { anonymizePath } from "./util.js";

export interface SearchOptions {
  includeReasoning?: boolean;
  includeToolOutput?: boolean;
  maxSnippets?: number;
  redact?: boolean;
  redactPatterns?: RegExp[];
}

function turnSearchText(turn: Turn, opts: SearchOptions): string {
  const parts: string[] = [];
  for (const block of turn.content) {
    if (block.kind === "text") parts.push(block.text);
    if (block.kind === "thinking" && opts.includeReasoning) parts.push(block.text);
    if (block.kind === "tool_result" && opts.includeToolOutput) {
      parts.push(
        typeof block.output === "string" ? block.output : JSON.stringify(block.output ?? ""),
      );
    }
  }
  return parts.join("\n");
}

function snippetAround(text: string, needle: string, radius = 60): string {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
}

function sessionPreviewSnippet(session: Session, opts: SearchOptions): string {
  for (const turn of session.turns) {
    if (turn.role !== "user") continue;
    const text = turnSearchText(turn, { ...opts, includeReasoning: false });
    if (!text.trim()) continue;
    let snippet = text.length > 120 ? `${text.slice(0, 120)}...` : text;
    if (opts.redact !== false) snippet = redactText(snippet, opts.redactPatterns);
    return snippet;
  }
  return "(session matched filters)";
}

export function searchSession(
  session: Session,
  queryInput: string,
  opts: SearchOptions = {},
): SearchMatch | null {
  const query = parseQuery(queryInput);
  if (!matchesSessionFilters(session, query)) return null;

  if (!hasTextQuery(query)) {
    return {
      sessionId: session.id,
      tool: session.tool,
      projectPath: session.projectPath ? anonymizePath(session.projectPath) : session.projectPath,
      timestamp: session.startedAt,
      snippets: [sessionPreviewSnippet(session, opts)],
      totalHits: 1,
    };
  }

  const textQuery = textOnlyQuery(query);
  const maxSnippets = opts.maxSnippets ?? 3;
  const snippets: string[] = [];
  let totalHits = 0;

  for (const turn of session.turns) {
    if (turn.role !== "user" && turn.role !== "assistant" && !opts.includeToolOutput) continue;
    const text = turnSearchText(turn, opts);
    if (!matchesQuery(text, textQuery)) continue;

    totalHits++;
    if (snippets.length < maxSnippets) {
      const needle = textQuery.phrases[0] ?? textQuery.terms[0] ?? queryInput;
      let snippet = snippetAround(text, needle);
      if (opts.redact !== false) snippet = redactText(snippet, opts.redactPatterns);
      snippets.push(snippet);
    }
  }

  if (totalHits === 0) return null;

  return {
    sessionId: session.id,
    tool: session.tool,
    projectPath: session.projectPath ? anonymizePath(session.projectPath) : session.projectPath,
    timestamp: session.startedAt,
    snippets,
    totalHits,
  };
}

export function parseSearchQuery(input: string) {
  return parseQuery(input);
}
