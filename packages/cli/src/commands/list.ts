import type { Warning } from "@logsesh/core";
import {
  LIST_ENVELOPE_FORMAT,
  applyEstimate,
  generatedAt,
  listEnvelopeSchema,
  mergeWarnings,
  sessionToSummary,
  toPublicWarnings,
} from "@logsesh/core";
import { printWarningsToStderr } from "../util/format.js";
import type { SharedCommandOptions } from "../util/options.js";
import { resolvePipelineOptions } from "../util/pipeline-options.js";
import { createScanProgress, shouldShowScanProgress } from "../util/progress.js";
import { describeActiveFilters } from "../ui/filters.js";
import { renderList } from "../ui/list.js";
import { resolveRenderMode, validateRenderOptions } from "../ui/mode.js";
import { iterateSessions } from "../util/session-source.js";

export async function runList(opts: SharedCommandOptions): Promise<number> {
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
  const sessions = [];

  const progress = createScanProgress({ enabled: shouldShowScanProgress(opts) });
  try {
    for await (const result of iterateSessions({
      ...resolved.pipeline,
      noIndex: opts.index === false,
      onFileDiscovered: (n) => progress.update(n),
    })) {
      mergeWarnings(warnings, result.warnings);
      if (!result.session) continue;
      let session = result.session;
      if (opts.estimateCost) session = applyEstimate(session);
      sessions.push(sessionToSummary(session));
    }
  } finally {
    progress.done();
  }

  if (opts.json) {
    const envelope = {
      format: LIST_ENVELOPE_FORMAT,
      generatedAt: generatedAt(),
      sessions,
      warnings: toPublicWarnings(warnings),
    };
    listEnvelopeSchema.parse(envelope);
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    printWarningsToStderr(warnings);
    const renderMode = resolveRenderMode(opts);
    const lines = renderList(sessions, renderMode, {
      filters: describeActiveFilters(opts),
    });
    for (const line of lines) console.log(line);
  }

  if (opts.json && sessions.length === 0) return 1;
  return 0;
}
