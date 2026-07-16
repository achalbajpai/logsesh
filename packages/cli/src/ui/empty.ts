export function renderEmpty(opts: { message: string; hint?: string }): string[] {
  const lines = [opts.message];
  if (opts.hint) lines.push(opts.hint);
  return lines;
}

export function emptySessionsMessage(filters: string): string {
  return `no sessions matched (${filters})`;
}

export function emptySessionsHint(filters: string): string | undefined {
  if (filters === "no filters") return "try: logsesh doctor";
  return undefined;
}

export function emptySearchMessage(filters: string): string {
  return `0 matches (${filters})`;
}

export function emptySearchHint(): string {
  return "try: logsesh search 'project:myapp auth'";
}
