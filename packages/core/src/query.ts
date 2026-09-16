import { KNOWN_QUERY_FIELDS, QUERY_FIELD_PATTERN, VALID_TOOLS } from "./constants.js";
import type { ToolName } from "./types.js";

export interface QueryFields {
  project?: string[];
  tool?: string[];
  model?: string[];
  agent?: string[];
  parent?: string[];
  branch?: string[];
  toolcall?: string[];
}

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  operator: "AND" | "OR";
  fields: QueryFields;
}

function pushField(fields: QueryFields, key: keyof QueryFields, value: string): void {
  const list = fields[key] ?? [];
  list.push(value);
  fields[key] = list;
}

export function parseQuery(input: string): ParsedQuery {
  const trimmed = input.trim();
  if (!trimmed) return { terms: [], phrases: [], operator: "OR", fields: {} };

  const fields: QueryFields = {};
  const fieldSpans: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  QUERY_FIELD_PATTERN.lastIndex = 0;
  while ((match = QUERY_FIELD_PATTERN.exec(trimmed)) !== null) {
    const key = match[1]!.toLowerCase();
    if (!KNOWN_QUERY_FIELDS.has(key)) continue;
    const value = match[3] ?? match[4] ?? "";
    if (key === "project") pushField(fields, "project", value);
    else if (key === "tool") pushField(fields, "tool", value);
    else if (key === "model") pushField(fields, "model", value);
    else if (key === "agent") pushField(fields, "agent", value);
    else if (key === "parent") pushField(fields, "parent", value);
    else if (key === "branch") pushField(fields, "branch", value);
    else if (key === "toolcall") pushField(fields, "toolcall", value);
    fieldSpans.push({ start: match.index, end: match.index + match[0].length });
  }

  let withoutFields = trimmed;
  for (const span of fieldSpans.sort((a, b) => b.start - a.start)) {
    withoutFields = withoutFields.slice(0, span.start) + " " + withoutFields.slice(span.end);
  }

  const operator = /\bAND\b/i.test(withoutFields) && !/\bOR\b/i.test(withoutFields) ? "AND" : "OR";
  const phrases: string[] = [];
  const withoutPhrases = withoutFields.replace(/"([^"]+)"/g, (_, phrase: string) => {
    phrases.push(phrase);
    return "";
  });

  const terms = withoutPhrases
    .replace(/\b(AND|OR)\b/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return { terms, phrases, operator, fields };
}

export function hasTextQuery(query: ParsedQuery): boolean {
  return query.terms.length > 0 || query.phrases.length > 0;
}

export function textOnlyQuery(query: ParsedQuery): ParsedQuery {
  return {
    terms: query.terms,
    phrases: query.phrases,
    operator: query.operator,
    fields: {},
  };
}

export function matchesQuery(text: string, query: ParsedQuery, caseSensitive = false): boolean {
  const haystack = caseSensitive ? text : text.toLowerCase();
  const parts = [
    ...query.phrases.map((p) => (caseSensitive ? p : p.toLowerCase())),
    ...query.terms.map((t) => (caseSensitive ? t : t.toLowerCase())),
  ].filter(Boolean);

  if (parts.length === 0) return true;

  if (query.operator === "AND") {
    return parts.every((part) => haystack.includes(part));
  }
  return parts.some((part) => haystack.includes(part));
}

export function parseToolField(value: string): ToolName | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code") return "claude-code";
  if (
    normalized === "agy" ||
    normalized === "antigravity" ||
    normalized === "antigravity-cli" ||
    normalized === "anti-gravity"
  ) {
    return "antigravity";
  }
  if (normalized === "gemini" || normalized === "gemini-cli") return "gemini";
  if (VALID_TOOLS.has(normalized as ToolName)) return normalized as ToolName;
  return undefined;
}
