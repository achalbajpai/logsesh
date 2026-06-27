import type { Warning } from "./types.js";

function warningKey(w: Warning): string {
  return [w.code, w.message, w.scope, w.line ?? "", w.sessionId ?? "", w.sourcePath ?? ""].join(
    "|",
  );
}

function summarizeKey(w: Warning): string {
  return [w.code, w.message, w.scope, w.sessionId ?? "", w.sourcePath ?? ""].join("|");
}

export interface SummarizedWarning {
  code: string;
  message: string;
  severity: Warning["severity"];
  scope: Warning["scope"];
  count: number;
  sourcePath?: string;
  sessionId?: string;
}

export function summarizeWarnings(warnings: Warning[]): SummarizedWarning[] {
  const groups = new Map<string, SummarizedWarning>();
  for (const warning of warnings) {
    const key = summarizeKey(warning);
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    groups.set(key, {
      code: warning.code,
      message: warning.message,
      severity: warning.severity,
      scope: warning.scope,
      count: 1,
      sourcePath: warning.sourcePath,
      sessionId: warning.sessionId,
    });
  }
  return [...groups.values()];
}

export function mergeWarnings(into: Warning[], from: Warning[]): void {
  const seen = new Set(into.map(warningKey));
  for (const w of from) {
    const key = warningKey(w);
    if (seen.has(key)) continue;
    seen.add(key);
    into.push(w);
  }
}
