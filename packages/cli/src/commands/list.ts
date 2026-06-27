import type { Warning } from "@logsesh/core";
import {
  applyEstimate,
  generatedAt,
  listEnvelopeSchema,
  mergeWarnings,
  runPipeline,
  sessionToSummary,
  toPublicWarnings,
} from "@logsesh/core";
import { printListTable, printWarningsToStderr } from "../util/format.js";
import type { SharedCommandOptions } from "../util/options.js";
import { resolvePipelineOptions } from "../util/pipeline-options.js";

export async function runList(opts: SharedCommandOptions): Promise<number> {
  const resolved = resolvePipelineOptions(opts);
  if (!resolved.ok) {
    console.error(resolved.error);
    return 2;
  }

  const warnings: Warning[] = [];
  const sessions = [];

  for await (const result of runPipeline(resolved.pipeline)) {
    mergeWarnings(warnings, result.warnings);
    if (!result.session) continue;
    let session = result.session;
    if (opts.estimateCost) session = applyEstimate(session);
    sessions.push(sessionToSummary(session));
  }

  if (opts.json) {
    const envelope = {
      format: "logsesh.list.v1" as const,
      generatedAt: generatedAt(),
      sessions,
      warnings: toPublicWarnings(warnings),
    };
    listEnvelopeSchema.parse(envelope);
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    printWarningsToStderr(warnings);
    printListTable(sessions);
  }

  if (opts.json && sessions.length === 0) return 1;
  return 0;
}
