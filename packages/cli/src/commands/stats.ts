import type { Warning } from "@logsesh/core";
import {
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

export async function runStats(opts: SharedCommandOptions): Promise<number> {
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
      format: "logsesh.stats.v1" as const,
      generatedAt: generatedAt(),
      stats,
      warnings: toPublicWarnings(warnings),
    };
    statsEnvelopeSchema.parse(envelope);
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    printWarningsToStderr(warnings);
    console.log(`Sessions: ${stats.sessionCount}`);
    console.log(`Turns: ${stats.turnCount}`);
    console.log(`Tokens: ${stats.totalTokens}`);
    console.log(`Known cost: $${stats.knownCostUsd.toFixed(2)}`);
    console.log(`Unknown cost sessions: ${stats.unknownCostSessionCount}`);
  }

  return 0;
}
