import { sanitizeInline } from "./layout.js";

export function describeActiveFilters(opts: {
  tool?: string;
  project?: string | string[];
  since?: string;
  until?: string;
  query?: string;
}): string {
  const parts: string[] = [];
  if (opts.tool) parts.push(`tool=${sanitizeInline(opts.tool)}`);
  const projects = Array.isArray(opts.project) ? opts.project : opts.project ? [opts.project] : [];
  if (projects.length > 0) parts.push(`project=${projects.map(sanitizeInline).join("|")}`);
  if (opts.since) parts.push(`since=${sanitizeInline(opts.since)}`);
  if (opts.until) parts.push(`until=${sanitizeInline(opts.until)}`);
  if (opts.query) parts.push(`query=${sanitizeInline(opts.query)}`);
  return parts.length > 0 ? parts.join(", ") : "no filters";
}
