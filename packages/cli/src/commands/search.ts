import type { Warning } from "@logsesh/core";
import {
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
import { resolveRenderMode, validateRenderOptions } from "../ui/mode.js";
import { renderSearchMatch, renderSearchSeparator } from "../ui/search.js";

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

  for await (const result of runPipeline(resolved.pipeline)) {
    mergeWarnings(warnings, result.warnings);
    if (!result.session) continue;
    const match = searchSession(result.session, opts.searchQuery, {
      includeReasoning: opts.includeReasoning,
      includeToolOutput: opts.includeToolOutput,
      redactPatterns: patterns,
    });
    if (match) matches.push(match);
  }

  if (opts.json) {
    const envelope = {
      format: "logsesh.search.v1" as const,
      generatedAt: generatedAt(),
      matches,
      warnings: toPublicWarnings(warnings),
    };
    searchEnvelopeSchema.parse(envelope);
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    printWarningsToStderr(warnings);
    const renderMode = resolveRenderMode(opts);
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index]!;
      for (const line of renderSearchMatch(match, opts.searchQuery, renderMode)) {
        console.log(line);
      }
      if (match.totalHits > match.snippets.length) {
        console.error(`  (+${match.totalHits - match.snippets.length} more hits)`);
      }
      if (index < matches.length - 1) {
        const separator = renderSearchSeparator(renderMode);
        if (separator) console.log(separator);
        else console.log("");
      }
    }
  }

  return matches.length > 0 ? 0 : 1;
}
