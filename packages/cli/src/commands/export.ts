import { type WriteStream, createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import type { ExportSession, ExportTurn, Session, Warning } from "@logsesh/core";
import {
  applyEstimate,
  beginJsonExportStream,
  exportJsonlRecord,
  exportSessionMarkdown,
  exportSessionsCsv,
  exportSummaryCsv,
  exportTurnMarkdown,
  mergeWarnings,
  parseRedactPatterns,
  redactUnknown,
  runPipeline,
  sanitizeForExport,
  serializeJsonlRecord,
  sessionToSummary,
  toPublicWarnings,
  writeExportFile,
} from "@logsesh/core";
import type { PipelineOptions, SanitizeOptions } from "@logsesh/core";
import { resolvePipelineOptions } from "../util/pipeline-options.js";

const EXPORT_FORMATS = ["json", "jsonl", "markdown", "csv"] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportOptions {
  format: ExportFormat | string;
  granularity?: "session" | "turn";
  summaryOnly?: boolean;
  out?: string;
  force?: boolean;
  tool?: string;
  project?: string;
  since?: string;
  until?: string;
  query?: string;
  redact?: boolean;
  redactPattern?: string[];
  includeReasoning?: boolean;
  anonymizePaths?: boolean;
  unsafeRaw?: boolean;
  estimateCost?: boolean;
  maxFileBytes?: number;
  maxTurnChars?: number;
  maxToolOutputChars?: number;
  roots?: string[];
}

function pipelineOpts(opts: ExportOptions): PipelineOptions | null {
  const resolved = resolvePipelineOptions(opts);
  if (!resolved.ok) {
    console.error(resolved.error);
    return null;
  }
  return resolved.pipeline;
}

function sanitizeOptsFromExport(opts: ExportOptions): SanitizeOptions {
  return {
    includeReasoning: opts.includeReasoning,
    rawPaths: opts.anonymizePaths === false,
  };
}

function parseExportFormat(value: string): ExportFormat | null {
  return (EXPORT_FORMATS as readonly string[]).includes(value) ? (value as ExportFormat) : null;
}

export async function runExport(opts: ExportOptions): Promise<number> {
  const format = parseExportFormat(String(opts.format));
  if (!format) {
    console.error(
      `Invalid export format: ${opts.format}. Expected one of: ${EXPORT_FORMATS.join(", ")}.`,
    );
    return 2;
  }
  if (opts.summaryOnly && format !== "csv") {
    console.error("Invalid export options: --summary-only requires --format csv.");
    return 2;
  }

  const pipeline = pipelineOpts(opts);
  if (!pipeline) return 2;

  if (!opts.redact && !opts.summaryOnly) {
    console.error("Warning: exporting full transcript without --redact may contain secrets.");
  }

  const sanitizeOpts = sanitizeOptsFromExport(opts);
  const parsedPatterns = opts.redactPattern
    ? parseRedactPatterns(opts.redactPattern)
    : { patterns: [], errors: [] };
  if (parsedPatterns.errors.length > 0) {
    console.error(parsedPatterns.errors.join("\n"));
    return 2;
  }
  const patterns = parsedPatterns.patterns;
  const warnings: Warning[] = [];
  const pubWarnings = () => toPublicWarnings(warnings);

  const sanitize = (session: Session): ExportSession => {
    let s = session;
    if (opts.estimateCost) s = applyEstimate(s);
    let exported: ExportSession = sanitizeForExport(s, sanitizeOpts);
    if (opts.redact) exported = redactUnknown(exported, patterns) as ExportSession;
    return exported;
  };

  const granular = opts.granularity ?? "session";

  if (opts.summaryOnly && format === "csv") {
    const summaries = [];
    for await (const result of runPipeline(pipeline)) {
      mergeWarnings(warnings, result.warnings);
      if (!result.session) continue;
      let session = result.session;
      if (opts.estimateCost) session = applyEstimate(session);
      summaries.push(sessionToSummary(session, sanitizeOpts));
    }
    const output = exportSummaryCsv(summaries);
    if (opts.out) await writeExportFile(opts.out, output, { force: opts.force });
    else process.stdout.write(output);
    return 0;
  }

  if (opts.out) {
    await exportToFile(format, opts, pipeline, sanitize, warnings, pubWarnings, granular);
    return 0;
  }

  if (format === "json") {
    const stream = beginJsonExportStream(process.stdout, {
      granularity: granular,
      getWarnings: pubWarnings,
      pretty: true,
    });
    for await (const result of runPipeline(pipeline)) {
      mergeWarnings(warnings, result.warnings);
      if (!result.session) continue;
      const exported = sanitize(result.session);
      if (granular === "turn") {
        for (const turn of exported.turns) stream.writeRecord(turn as ExportTurn);
      } else {
        stream.writeRecord(exported);
      }
    }
    stream.end();
    return 0;
  }

  if (format === "csv") {
    const csvSessions: ExportSession[] = [];
    for await (const result of runPipeline(pipeline)) {
      mergeWarnings(warnings, result.warnings);
      if (!result.session) continue;
      csvSessions.push(sanitize(result.session));
    }
    process.stdout.write(exportSessionsCsv(csvSessions));
    return 0;
  }

  for await (const result of runPipeline(pipeline)) {
    mergeWarnings(warnings, result.warnings);
    if (!result.session) continue;
    const exported = sanitize(result.session);

    if (format === "jsonl") {
      if (granular === "turn") {
        for (const turn of exported.turns) {
          process.stdout.write(
            serializeJsonlRecord(exportJsonlRecord(turn as ExportTurn, pubWarnings())) + "\n",
          );
        }
      } else {
        process.stdout.write(
          serializeJsonlRecord(exportJsonlRecord(exported, pubWarnings())) + "\n",
        );
      }
    } else if (format === "markdown") {
      if (granular === "turn") {
        for (const turn of exported.turns) {
          process.stdout.write(
            exportTurnMarkdown(turn as ExportTurn, exported, opts.unsafeRaw) + "\n",
          );
        }
      } else {
        process.stdout.write(exportSessionMarkdown(exported, opts.unsafeRaw) + "\n");
      }
    }
  }

  return 0;
}

function openExportStream(outPath: string, force?: boolean): Promise<WriteStream> {
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(outPath, {
      flags: force ? "w" : "wx",
      encoding: "utf8",
      mode: 0o600,
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", (err) => {
      if (!force && err instanceof Error && "code" in err && err.code === "EEXIST") {
        reject(
          new Error(`Refusing to overwrite existing file: ${outPath}. Use --force to overwrite.`),
        );
        return;
      }
      reject(err);
    });
  });
}

async function exportToFile(
  format: ExportFormat,
  opts: ExportOptions,
  pipeline: PipelineOptions,
  sanitize: (session: Session) => ExportSession,
  warnings: Warning[],
  pubWarnings: () => ReturnType<typeof toPublicWarnings>,
  granular: "session" | "turn",
): Promise<void> {
  const outPath = opts.out!;
  const ws = await openExportStream(outPath, opts.force);

  try {
    if (format === "json") {
      const stream = beginJsonExportStream(ws, {
        granularity: granular,
        getWarnings: pubWarnings,
        pretty: true,
      });
      for await (const result of runPipeline(pipeline)) {
        mergeWarnings(warnings, result.warnings);
        if (!result.session) continue;
        const exported = sanitize(result.session);
        if (granular === "turn") {
          for (const turn of exported.turns) stream.writeRecord(turn as ExportTurn);
        } else {
          stream.writeRecord(exported);
        }
      }
      stream.end();
    } else if (format === "csv") {
      const csvSessions: ExportSession[] = [];
      for await (const result of runPipeline(pipeline)) {
        mergeWarnings(warnings, result.warnings);
        if (!result.session) continue;
        csvSessions.push(sanitize(result.session));
      }
      ws.write(exportSessionsCsv(csvSessions));
    } else {
      for await (const result of runPipeline(pipeline)) {
        mergeWarnings(warnings, result.warnings);
        if (!result.session) continue;
        const exported = sanitize(result.session);
        let chunk = "";
        if (format === "jsonl") {
          if (granular === "turn") {
            for (const turn of exported.turns) {
              chunk +=
                serializeJsonlRecord(exportJsonlRecord(turn as ExportTurn, pubWarnings())) + "\n";
            }
          } else {
            chunk = serializeJsonlRecord(exportJsonlRecord(exported, pubWarnings())) + "\n";
          }
        } else if (format === "markdown") {
          chunk =
            granular === "turn"
              ? exported.turns
                  .map((turn) => exportTurnMarkdown(turn as ExportTurn, exported, opts.unsafeRaw))
                  .join("\n") + "\n"
              : exportSessionMarkdown(exported, opts.unsafeRaw) + "\n";
        }
        ws.write(chunk);
      }
    }
    ws.end();
    await finished(ws);
  } catch (err) {
    ws.destroy();
    if (err instanceof Error && err.message.includes("Refusing to overwrite")) throw err;
    throw err;
  }
}
