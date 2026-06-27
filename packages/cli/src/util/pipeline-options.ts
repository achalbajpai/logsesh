import type { PipelineOptions } from "@logsesh/core";
import { parseRootsOverride } from "@logsesh/core";
import { parseSinceUntil, parseToolFilter } from "./format.js";
import type { SharedCommandOptions } from "./options.js";

export type ResolvedPipelineOptions =
  | { ok: true; pipeline: PipelineOptions }
  | { ok: false; error: string };

export function resolvePipelineOptions(
  opts: SharedCommandOptions & { query?: string; queryTextFilter?: boolean },
): ResolvedPipelineOptions {
  const toolResult = parseToolFilter(opts.tool);
  if (toolResult.error) return { ok: false, error: toolResult.error };

  const sinceResult = parseSinceUntil(opts.since, "since");
  if (sinceResult.error) return { ok: false, error: sinceResult.error };

  const untilResult = parseSinceUntil(opts.until, "until");
  if (untilResult.error) return { ok: false, error: untilResult.error };

  let roots: PipelineOptions["roots"];
  if (opts.roots && opts.roots.length > 0) {
    const parsed = parseRootsOverride(opts.roots);
    if (parsed.errors.length > 0) {
      return { ok: false, error: parsed.errors.join("\n") };
    }
    roots = parsed.roots;
  }

  return {
    ok: true,
    pipeline: {
      toolFilter: toolResult.tools,
      projectFilter: opts.project,
      since: sinceResult.date,
      until: untilResult.date,
      query: opts.query,
      queryTextFilter: opts.queryTextFilter,
      maxFileBytes: opts.maxFileBytes,
      maxTurnChars: opts.maxTurnChars,
      maxToolOutputChars: opts.maxToolOutputChars,
      roots,
    },
  };
}
