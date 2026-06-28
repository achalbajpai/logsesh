export function describeActiveFilters(opts: {
  tool?: string;
  project?: string | string[];
  since?: string;
  until?: string;
  query?: string;
}): string {
  const parts: string[] = [];
  if (opts.tool) parts.push(`tool=${opts.tool}`);
  const projects = Array.isArray(opts.project) ? opts.project : opts.project ? [opts.project] : [];
  if (projects.length > 0) parts.push(`project=${projects.join("|")}`);
  if (opts.since) parts.push(`since=${opts.since}`);
  if (opts.until) parts.push(`until=${opts.until}`);
  if (opts.query) parts.push(`query=${opts.query}`);
  return parts.length > 0 ? parts.join(", ") : "no filters";
}
