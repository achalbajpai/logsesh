const BUILTIN_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{20,}/g,
  /sk-proj-[A-Za-z0-9_-]{20,}/g,
  /sk-ant-[A-Za-z0-9\-_]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9\-_]{20,}/g,
  /npm_[A-Za-z0-9]{36,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /ASIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:^|[\s;])(?:API_KEY|SECRET|PASSWORD|TOKEN)\s*=\s*[^\s#]+/gim,
];

export function getBuiltinPatterns(): RegExp[] {
  return BUILTIN_PATTERNS.map((p) => new RegExp(p.source, p.flags));
}

export function redactText(text: string, extraPatterns: RegExp[] = []): string {
  let result = text;
  for (const pattern of [...getBuiltinPatterns(), ...extraPatterns]) {
    result = result.replace(pattern, "[REDACTED]");
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
