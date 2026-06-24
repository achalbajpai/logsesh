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
  matchesProject,
  matchesSessionQuery,
} from "./discovery.js";
import { getAllAdapters, getEnabledAdapters } from "./adapters/index.js";
import { mergeWarnings } from "./warnings.js";

export interface PipelineResult {
  session?: Session;
  warnings: Warning[];
}

const DEFAULT_PARSE_CONCURRENCY = 4;

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
    for await (const session of adapter.parse(file, opts)) {
      if (!matchesProject(session.projectPath, opts.projectFilter)) continue;
      if (!matchesDateRange(session.startedAt, session.endedAt, opts.since, opts.until)) continue;
      if (!matchesSessionQuery(session, opts.query)) continue;
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
    while (batches.length > 0 && batches[0]!.order === nextToYield) {
      const batch = batches.shift()!;
      nextToYield++;
      ready.push(...batch.results);
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
        let task!: Promise<void>;
        task = (async () => {
          let batchResults: PipelineResult[] = [];
          try {
            const parsed = await parseFile(file);
            batchResults = parsed.map(({ session, warnings: sessionWarnings }) =>
              makeResult(session, sessionWarnings),
            );
          } finally {
            enqueueBatch(fileOrder, batchResults);
            inFlight--;
            pending.delete(task);
          }
        })();
        pending.add(task);
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
  if (workerError) throw workerError;

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
