import { type WriteStream, createWriteStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { finished } from "node:stream/promises";
import type { ExportSession, Session, Warning } from "@logsesh/core";
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

import { EXPORT_FILE_MODE, EXPORT_FORMATS, type ExportFormat } from "../constants.js";

export interface ExportOptions {
  format: string;
  granularity?: "session" | "turn";
  summaryOnly?: boolean;
  out?: string;
  force?: boolean;
  tool?: string;
  project?: string | string[];
  since?: string;
  until?: string;
  query?: string;
  redact?: boolean;
  allowSensitive?: boolean;
  noRedact?: boolean;
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

function isWithinBase(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function resolveSafeOutputPath(outPath: string): Promise<string> {
  const cwd = process.cwd();
  const resolved = resolve(cwd, outPath);
  const trustedBase = await realpath(cwd);
  const realParent = await realpath(dirname(resolved));
  if (!isWithinBase(trustedBase, realParent)) {
    throw new Error(`Refusing to write outside the current directory with --out path: ${outPath}.`);
  }

  try {
    const outputStat = await lstat(resolved);
    if (outputStat.isSymbolicLink()) {
      throw new Error(`Refusing to write to symlink output path: ${outPath}.`);
    }
  } catch (err) {
    const code =
      err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : undefined;
    if (code !== "ENOENT") throw err;
  }
  return resolved;
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

function shouldRedact(opts: ExportOptions): boolean {
  if (opts.summaryOnly) return Boolean(opts.redact);
  if (opts.allowSensitive || opts.noRedact) return false;
  return true;
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

  const redact = shouldRedact(opts);
  if (!opts.summaryOnly && !redact) {
    console.error("Warning: exporting full transcript with --allow-sensitive may contain secrets.");
  }
  if (opts.unsafeRaw) {
    console.error(
      "Warning: --unsafe-raw disables Markdown injection protection; only use it for trusted output that will not be rendered as HTML.",
    );
  }

  let outputPath: string | undefined;
  if (opts.out) {
    try {
      outputPath = await resolveSafeOutputPath(opts.out);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
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
    if (redact) exported = redactUnknown(exported, patterns);
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
    if (outputPath) await writeExportFile(outputPath, output, { force: opts.force });
    else process.stdout.write(output);
    return 0;
  }

  if (outputPath) {
    await exportToFile(
      format,
      opts,
      pipeline,
      sanitize,
      warnings,
      pubWarnings,
      granular,
      outputPath,
    );
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
        for (const turn of exported.turns) stream.writeRecord(turn);
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
          process.stdout.write(serializeJsonlRecord(exportJsonlRecord(turn, pubWarnings())) + "\n");
        }
      } else {
        process.stdout.write(
          serializeJsonlRecord(exportJsonlRecord(exported, pubWarnings())) + "\n",
        );
      }
    } else if (format === "markdown") {
      if (granular === "turn") {
        for (const turn of exported.turns) {
          process.stdout.write(exportTurnMarkdown(turn, exported, opts.unsafeRaw) + "\n");
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
      mode: EXPORT_FILE_MODE,
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
  outPath: string,
): Promise<void> {
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
          for (const turn of exported.turns) stream.writeRecord(turn);
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
              chunk += serializeJsonlRecord(exportJsonlRecord(turn, pubWarnings())) + "\n";
            }
          } else {
            chunk = serializeJsonlRecord(exportJsonlRecord(exported, pubWarnings())) + "\n";
          }
        } else if (format === "markdown") {
          chunk =
            granular === "turn"
              ? exported.turns
                  .map((turn) => exportTurnMarkdown(turn, exported, opts.unsafeRaw))
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
    throw err instanceof Error ? err : new Error(String(err));
  }
}
