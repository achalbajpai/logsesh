import type { PipelineOptions, PipelineResult, Warning } from "@logsesh/core";
import { runPipeline } from "@logsesh/core";
import { indexExists, queryIndex } from "../store/query.js";

export async function* iterateSessions(
  opts: PipelineOptions & { noIndex?: boolean; indexPath?: string },
  extra: { forceLive?: boolean } = {},
): AsyncIterable<PipelineResult> {
  const hasRoots = Boolean(opts.roots && Object.keys(opts.roots).length > 0);
  const canUseIndex =
    !opts.noIndex &&
    !extra.forceLive &&
    (await indexExists(opts.indexPath)) &&
    (!hasRoots || opts.indexPath !== undefined);
  if (canUseIndex) {
    const indexed = await queryIndex(opts);
    if (indexed?.error) {
      yield {
        warnings: [
          {
            code: "index_unavailable",
            message: indexed.error,
            severity: "warn",
            scope: "index",
          } satisfies Warning,
        ],
      };
    } else if (indexed?.stale) {
      yield {
        warnings: [
          {
            code: "index_stale",
            message:
              "Index is out of date; scanning live logs. Run `logsesh index build` to refresh.",
            severity: "info",
            scope: "index",
          } satisfies Warning,
        ],
      };
      yield* runPipeline(opts);
      return;
    } else if (indexed) {
      for (const result of indexed.sessions) {
        yield { session: result.session, warnings: result.warnings };
      }
      return;
    }
  }

  yield* runPipeline(opts);
}
