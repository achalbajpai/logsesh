import { BUILTIN_REDACT_PATTERNS, REDACTED_PLACEHOLDER } from "./constants.js";

export function getBuiltinPatterns(): RegExp[] {
  return BUILTIN_REDACT_PATTERNS.map((p) => new RegExp(p.source, p.flags));
}

export function redactText(text: string, extraPatterns: RegExp[] = []): string {
  let result = text;
  for (const pattern of [...getBuiltinPatterns(), ...extraPatterns]) {
    result = result.replace(pattern, REDACTED_PLACEHOLDER);
  }
  return result;
}

export function redactUnknown<T>(value: T, patterns: RegExp[] = []): T {
  if (typeof value === "string") {
    return redactText(value, patterns) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactUnknown(v, patterns)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactUnknown(v, patterns);
    }
    return out as T;
  }
  return value;
}

export interface ParseRedactPatternsResult {
  patterns: RegExp[];
  errors: string[];
}

export function parseRedactPatterns(patterns: string[]): ParseRedactPatternsResult {
  const parsed: RegExp[] = [];
  const errors: string[] = [];
  for (const pattern of patterns) {
    try {
      parsed.push(new RegExp(pattern, "g"));
    } catch (err) {
      errors.push(
        `Invalid redact pattern "${pattern}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { patterns: parsed, errors };
}
