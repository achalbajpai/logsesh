import { KNOWN_QUERY_FIELDS, QUERY_FIELD_PATTERN } from "./constants.js";

interface QueryFields {
  project?: string[];
}

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  operator: "AND" | "OR";
  fields: QueryFields;
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
    if (key === "project") {
      fields.project = fields.project ?? [];
      fields.project.push(value);
    }
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
