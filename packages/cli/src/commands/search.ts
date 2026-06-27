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
import { formatProject, printWarningsToStderr } from "../util/format.js";
import type { SharedCommandOptions } from "../util/options.js";
import { resolvePipelineOptions } from "../util/pipeline-options.js";

export interface SearchOptions extends SharedCommandOptions {
  searchQuery: string;
  includeReasoning?: boolean;
  includeToolOutput?: boolean;
  redactPattern?: string[];
}

export async function runSearch(opts: SearchOptions): Promise<number> {
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
    for (const m of matches) {
      console.log(
        `${m.tool}  ${formatProject(m.projectPath, 28)}  ${m.timestamp ?? "-"}  ${m.sessionId}`,
      );
      for (const s of m.snippets) console.log(`  ${s}`);
      if (m.totalHits > m.snippets.length) {
        console.error(`  (+${m.totalHits - m.snippets.length} more hits)`);
      }
    }
  }

  return matches.length > 0 ? 0 : 1;
}
