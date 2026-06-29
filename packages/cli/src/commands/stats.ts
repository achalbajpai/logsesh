import type { Warning } from "@logsesh/core";
import {
  STATS_ENVELOPE_FORMAT,
  StatsAggregator,
  applyEstimate,
  generatedAt,
  mergeWarnings,
  runPipeline,
  statsEnvelopeSchema,
  toPublicWarnings,
} from "@logsesh/core";
import { printWarningsToStderr } from "../util/format.js";
import type { SharedCommandOptions } from "../util/options.js";
import { resolvePipelineOptions } from "../util/pipeline-options.js";
import { buildStatsFilters, renderStats } from "../ui/stats.js";
import { resolveRenderMode, validateRenderOptions } from "../ui/mode.js";

export async function runStats(opts: SharedCommandOptions): Promise<number> {
  if (!opts.json) {
    const renderError = validateRenderOptions(opts);
    if (renderError) {
      console.error(renderError);
      return 2;
    }
  }

  const resolved = resolvePipelineOptions(opts);
  if (!resolved.ok) {
    console.error(resolved.error);
    return 2;
  }

  const warnings: Warning[] = [];
  const agg = new StatsAggregator();
  agg.useEstimates = !!opts.estimateCost;

  for await (const result of runPipeline(resolved.pipeline)) {
    mergeWarnings(warnings, result.warnings);
    if (!result.session) continue;
    let session = result.session;
    if (opts.estimateCost) session = applyEstimate(session);
    agg.add(session);
  }

  const stats = agg.report();

  if (opts.json) {
    const envelope = {
      format: STATS_ENVELOPE_FORMAT,
      generatedAt: generatedAt(),
      stats,
      warnings: toPublicWarnings(warnings),
    };
    statsEnvelopeSchema.parse(envelope);
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    printWarningsToStderr(warnings);
    const renderMode = resolveRenderMode(opts);
    const lines = renderStats(stats, renderMode, {
      filters: buildStatsFilters(opts),
      usedEstimates: !!opts.estimateCost,
    });
    for (const line of lines) console.log(line);
  }

  if (opts.json && stats.sessionCount === 0) return 1;
  return 0;
}
