export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  operator: "AND" | "OR";
}

export function parseQuery(input: string): ParsedQuery {
  const trimmed = input.trim();
  if (!trimmed) return { terms: [], phrases: [], operator: "OR" };

  const operator = /\bAND\b/i.test(trimmed) && !/\bOR\b/i.test(trimmed) ? "AND" : "OR";
  const phrases: string[] = [];
  const withoutPhrases = trimmed.replace(/"([^"]+)"/g, (_, phrase: string) => {
    phrases.push(phrase);
    return "";
  });

  const terms = withoutPhrases
    .replace(/\b(AND|OR)\b/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return { terms, phrases, operator };
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
