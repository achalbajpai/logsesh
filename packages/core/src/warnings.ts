import type { Warning } from "./types.js";

function warningKey(w: Warning): string {
  return [w.code, w.message, w.scope, w.line ?? "", w.sessionId ?? "", w.sourcePath ?? ""].join(
    "|",
  );
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
