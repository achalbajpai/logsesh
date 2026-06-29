import { DEFAULT_PARSE_CONCURRENCY } from "./constants.js";
import type {
  ParseOptions,
  PipelineOptions,
  PublicWarning,
  Session,
  SessionFile,
  ToolName,
  Warning,
} from "./types.js";
import {
  discoverFiles,
  matchesDateRange,
  matchesSessionFilters,
  matchesSessionTextQuery,
} from "./discovery.js";
import { parseQuery } from "./query.js";
import { getAllAdapters, getEnabledAdapters } from "./adapters/index.js";
import { mergeWarnings } from "./warnings.js";

export interface PipelineResult {
  session?: Session;
  warnings: Warning[];
}
interface OrderedBatch {
  order: number;
  results: PipelineResult[];
}

export async function* runPipeline(opts: PipelineOptions = {}): AsyncIterable<PipelineResult> {
  const detectWarnings: Warning[] = [];
  const adapters = await getEnabledAdapters(opts.toolFilter, detectWarnings, opts);
  const adapterByTool = new Map(adapters.map((a) => [a.tool, a]));
  const sharedWarnings: Warning[] = [...detectWarnings];
  const limit = opts.maxParseConcurrency ?? DEFAULT_PARSE_CONCURRENCY;

  let sharedAttached = false;
  let yieldedAny = false;

  async function parseFile(
    file: SessionFile,
  ): Promise<Array<{ session: Session; warnings: Warning[] }>> {
    const adapter = adapterByTool.get(file.tool);
    if (!adapter) return [];
    const results: Array<{ session: Session; warnings: Warning[] }> = [];
    const parsedQuery = parseQuery(opts.query ?? "");
    for await (const session of adapter.parse(file, opts)) {
      if (!matchesSessionFilters(session, parsedQuery, opts.projectFilter)) continue;
      if (!matchesDateRange(session.startedAt, session.endedAt, opts.since, opts.until)) continue;
      if (opts.queryTextFilter !== false && !matchesSessionTextQuery(session, parsedQuery)) {
        continue;
      }
      results.push({ session, warnings: session.warnings ?? [] });
    }
    return results;
  }

  function makeResult(session: Session, sessionWarnings: Warning[]): PipelineResult {
    yieldedAny = true;
    const warnings: Warning[] = [];
    if (!sharedAttached) {
      sharedAttached = true;
      mergeWarnings(warnings, sharedWarnings);
    }
    mergeWarnings(warnings, sessionWarnings);
    return { session, warnings };
  }

  const batches: OrderedBatch[] = [];
  let nextToYield = 0;
  let done = false;
  let workerError: unknown;
  const waiters: Array<() => void> = [];
  const notify = () => {
    for (const resolve of waiters.splice(0)) resolve();
  };

  function enqueueBatch(order: number, results: PipelineResult[]) {
    batches.push({ order, results });
    batches.sort((a, b) => a.order - b.order);
    notify();
  }

  function drainReady(): PipelineResult[] {
    const ready: PipelineResult[] = [];
    batches.sort((a, b) => a.order - b.order);
    while (batches.length > 0) {
      const head = batches[0];
      if (!head || head.order !== nextToYield) break;
      batches.shift();
      nextToYield++;
      ready.push(...head.results);
    }
    return ready;
  }

  const worker = (async () => {
    try {
      let inFlight = 0;
      const pending = new Set<Promise<void>>();
      let discoveryOrder = 0;

      for await (const file of discoverFiles(opts, adapters, (tool, err) => {
        sharedWarnings.push({
          code: "discovery_error",
          message: `Failed to discover ${tool} logs`,
          severity: "warn",
          scope: "discovery",
          cause: err instanceof Error ? err.message : String(err),
        });
      })) {
        const fileOrder = discoveryOrder++;
        while (inFlight >= limit) {
          if (pending.size === 0) break;
          await Promise.race(pending);
        }

        inFlight++;
        const task = (async () => {
          let batchResults: PipelineResult[] = [];
          try {
            const parsed = await parseFile(file);
            batchResults = parsed.map(({ session, warnings: sessionWarnings }) =>
              makeResult(session, sessionWarnings),
            );
          } finally {
            enqueueBatch(fileOrder, batchResults);
            inFlight--;
          }
        })();
        pending.add(task);
        void task.finally(() => {
          pending.delete(task);
        });
      }

      await Promise.all(pending);
    } catch (err) {
      workerError = err;
    } finally {
      done = true;
      notify();
    }
  })();

  while (true) {
    const ready = drainReady();
    for (const result of ready) {
      yield result;
    }
    if (done && batches.length === 0) break;
    if (ready.length === 0) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }

  await worker;
  if (workerError !== undefined) {
    const message =
      workerError instanceof Error
        ? workerError.message
        : typeof workerError === "string"
          ? workerError
          : JSON.stringify(workerError);
    throw workerError instanceof Error ? workerError : new Error(message);
  }

  if (!yieldedAny && sharedWarnings.length > 0) {
    yield { warnings: sharedWarnings };
  }
}

export function toPublicWarnings(warnings: Warning[]): PublicWarning[] {
  return warnings.map(({ sourcePath: _sourcePath, ...rest }) => rest);
}

export async function parseFile(
  filePath: string,
  tool: ToolName,
  opts: ParseOptions = {},
): Promise<Session | null> {
  const adapter = getAllAdapters().find((a) => a.tool === tool);
  if (!adapter) return null;
  for await (const session of adapter.parse({ path: filePath, tool }, opts)) {
    return session;
  }
  return null;
}
