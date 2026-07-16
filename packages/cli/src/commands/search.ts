import type { Warning } from "@logsesh/core";
import {
  SEARCH_ENVELOPE_FORMAT,
  generatedAt,
  mergeWarnings,
  parseRedactPatterns,
  runPipeline,
  searchEnvelopeSchema,
  searchSession,
  toPublicWarnings,
} from "@logsesh/core";
import { printWarningsToStderr } from "../util/format.js";
import type { SharedCommandOptions } from "../util/options.js";
import { resolvePipelineOptions } from "../util/pipeline-options.js";
import { createScanProgress, shouldShowScanProgress } from "../util/progress.js";
import { describeActiveFilters } from "../ui/filters.js";
import { resolveRenderMode, validateRenderOptions } from "../ui/mode.js";
import { renderSearchEmpty, renderSearchMatches } from "../ui/search.js";

export interface SearchOptions extends SharedCommandOptions {
  searchQuery: string;
  includeReasoning?: boolean;
  includeToolOutput?: boolean;
  redactPattern?: string[];
}

export async function runSearch(opts: SearchOptions): Promise<number> {
  if (!opts.json) {
    const renderError = validateRenderOptions(opts);
    if (renderError) {
      console.error(renderError);
      return 2;
    }
  }

  const resolved = resolvePipelineOptions({
    ...opts,
    query: opts.searchQuery,
    queryTextFilter: false,
  });
  if (!resolved.ok) {
    console.error(resolved.error);
    return 2;
  }

  const warnings: Warning[] = [];
  const matches = [];
  const parsedPatterns = opts.redactPattern
    ? parseRedactPatterns(opts.redactPattern)
    : { patterns: [], errors: [] };
  if (parsedPatterns.errors.length > 0) {
    console.error(parsedPatterns.errors.join("\n"));
    return 2;
  }
  const patterns = parsedPatterns.patterns;

  const progress = createScanProgress({ enabled: shouldShowScanProgress(opts) });
  try {
    for await (const result of runPipeline({
      ...resolved.pipeline,
      onFileDiscovered: (n) => progress.update(n),
    })) {
      mergeWarnings(warnings, result.warnings);
      if (!result.session) continue;
      const match = searchSession(result.session, opts.searchQuery, {
        includeReasoning: opts.includeReasoning,
        includeToolOutput: opts.includeToolOutput,
        redactPatterns: patterns,
      });
      if (match) matches.push(match);
    }
  } finally {
    progress.done();
  }

  if (opts.json) {
    const envelope = {
      format: SEARCH_ENVELOPE_FORMAT,
      generatedAt: generatedAt(),
      matches,
      warnings: toPublicWarnings(warnings),
    };
    searchEnvelopeSchema.parse(envelope);
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    printWarningsToStderr(warnings);
    const renderMode = resolveRenderMode(opts);
    const filters = describeActiveFilters({ ...opts, query: opts.searchQuery });
    if (matches.length === 0) {
      for (const line of renderSearchEmpty(filters, renderMode)) {
        console.log(line);
      }
    } else {
      for (const line of renderSearchMatches(matches, opts.searchQuery, renderMode, { filters })) {
        console.log(line);
      }
      for (const match of matches) {
        if (match.totalHits > match.snippets.length) {
          console.error(`  (+${match.totalHits - match.snippets.length} more hits)`);
        }
      }
    }
  }

  return matches.length > 0 ? 0 : 1;
}
