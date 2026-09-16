import type { ParseOptions, SourceFidelity, ToolName, Warning } from "./types.js";
import { type JsonlScanResult, readJsonl } from "./jsonl-reader.js";

export interface ParseContextOptions {
  tool: ToolName;
  sourcePath: string;
  sessionId?: string;
}

export class ParseContext {
  private totalRecords = 0;
  private recognizedRecords = 0;
  private ignoredKnownRecords = 0;
  private unknownRecords = 0;
  private malformedRecords = 0;
  private oversizedRecords = 0;
  private bytesObserved = 0;
  private bytesParsed = 0;
  private metadataOnly = false;
  private readonly unknownTypes = new Map<string, number>();
  private readonly unknownBlocks = new Map<string, number>();
  private readonly partialReasons: string[] = [];
  private readonly warnings: Warning[] = [];

  constructor(private readonly opts: ParseContextOptions) {}

  observeRecord(bytes: number): void {
    this.totalRecords += 1;
    this.bytesObserved += bytes;
  }

  addBytesParsed(bytes: number): void {
    this.bytesParsed += bytes;
  }

  observeSkippedBytes(bytes: number): void {
    this.bytesObserved += bytes;
  }

  recognized(_type?: string): void {
    this.recognizedRecords += 1;
  }

  ignoredKnown(_type?: string): void {
    this.ignoredKnownRecords += 1;
  }

  unknown(type?: string): void {
    this.unknownRecords += 1;
    const key = type?.trim() ? type : "<missing>";
    this.unknownTypes.set(key, (this.unknownTypes.get(key) ?? 0) + 1);
  }

  unknownContentBlock(type?: string): void {
    const key = type?.trim() ? type : "<missing>";
    this.unknownBlocks.set(key, (this.unknownBlocks.get(key) ?? 0) + 1);
    this.markPartial("unknown content blocks");
  }

  malformed(message: string, line?: number): void {
    this.malformedRecords += 1;
    this.addWarning({
      code: "malformed_record",
      message,
      severity: "warn",
      scope: "parse",
      line,
    });
  }

  oversized(bytes: number, line?: number): void {
    this.oversizedRecords += 1;
    this.markPartial("oversized record skipped");
    this.addWarning({
      code: "oversized_record",
      message: `Record exceeds max size (${bytes} bytes), skipped`,
      severity: "warn",
      scope: "parse",
      line,
    });
  }

  markPartial(reason: string): void {
    if (!this.partialReasons.includes(reason)) this.partialReasons.push(reason);
  }

  markMetadataOnly(reason: string): void {
    this.metadataOnly = true;
    this.markPartial(reason);
  }

  addWarning(warning: {
    code: string;
    message: string;
    severity: Warning["severity"];
    scope?: Warning["scope"];
    sourcePath?: string;
    sessionId?: string;
    line?: number;
    cause?: string;
  }): void {
    this.warnings.push({
      code: warning.code,
      message: warning.message,
      severity: warning.severity,
      scope: warning.scope ?? "parse",
      sourcePath: warning.sourcePath ?? this.opts.sourcePath,
      sessionId: warning.sessionId ?? this.opts.sessionId,
      line: warning.line,
      cause: warning.cause,
    });
  }

  setSessionId(sessionId: string): void {
    this.opts.sessionId = sessionId;
  }

  unknownRecordTypes(): string[] {
    return [...this.unknownTypes.keys()].sort();
  }

  counters() {
    return {
      totalRecords: this.totalRecords,
      recognizedRecords: this.recognizedRecords,
      ignoredKnownRecords: this.ignoredKnownRecords,
      unknownRecords: this.unknownRecords,
      malformedRecords: this.malformedRecords,
      oversizedRecords: this.oversizedRecords,
      bytesObserved: this.bytesObserved,
      bytesParsed: this.bytesParsed,
    };
  }

  drainWarnings(): Warning[] {
    const out = [...this.warnings];
    if (this.unknownTypes.size > 0) {
      const parts = [...this.unknownTypes.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([type, count]) => `${count} "${type}"`)
        .join(", ");
      out.push({
        code: "unknown_record_type",
        message: `${this.opts.tool}: unknown record types: ${parts}`,
        severity: "warn",
        scope: "parse",
        sourcePath: this.opts.sourcePath,
        sessionId: this.opts.sessionId,
      });
    }
    if (this.unknownBlocks.size > 0) {
      const parts = [...this.unknownBlocks.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([type, count]) => `${count} of unknown type "${type}"`)
        .join("; ");
      out.push({
        code: "unknown_content_block",
        message: `${this.opts.tool}: ${parts} were skipped`,
        severity: "warn",
        scope: "parse",
        sourcePath: this.opts.sourcePath,
        sessionId: this.opts.sessionId,
      });
    }
    return out;
  }

  finalize(): SourceFidelity {
    const completeness = this.metadataOnly
      ? "metadata-only"
      : this.partialReasons.length > 0 ||
          this.unknownRecords > 0 ||
          this.malformedRecords > 0 ||
          this.oversizedRecords > 0 ||
          this.bytesParsed < this.bytesObserved
        ? "partial"
        : "complete";

    return {
      completeness,
      reason: this.partialReasons[0],
      recordsObserved: this.totalRecords,
      recordsRecognized: this.recognizedRecords,
      recordsIgnored: this.ignoredKnownRecords,
      recordsUnknown: this.unknownRecords,
      recordsMalformed: this.malformedRecords,
      recordsOversized: this.oversizedRecords,
      unknownRecordTypes: this.unknownTypes.size > 0 ? this.unknownRecordTypes() : undefined,
    };
  }
}

export async function scanSource(
  filePath: string,
  ctx: ParseContext,
  opts: ParseOptions,
  onLine: (text: string, lineNumber: number) => void,
): Promise<JsonlScanResult> {
  const result = await readJsonl(
    filePath,
    (row) => {
      if (row.kind === "gap") {
        ctx.observeSkippedBytes(row.skippedBytes);
        ctx.markPartial("large-file head/tail scan");
        ctx.addWarning({
          code: "partial_large_file",
          message: `Skipped ${row.skippedBytes} bytes in degraded large-file mode`,
          severity: "warn",
        });
        return;
      }
      if (row.kind === "oversized") {
        ctx.observeRecord(row.byteLength);
        ctx.oversized(row.byteLength, row.lineNumber);
        return;
      }
      ctx.observeRecord(row.byteLength);
      onLine(row.text, row.lineNumber);
      ctx.addBytesParsed(row.byteLength);
    },
    {
      maxFileBytes: opts.maxFileBytes,
      maxRecordBytes: opts.maxRecordBytes,
      largeFileMode: opts.largeFileMode,
    },
  );

  if (result.skipped) {
    ctx.markMetadataOnly(`File exceeds max size (${result.size} bytes), skipped`);
    ctx.addWarning({
      code: "file_too_large",
      message: `File exceeds max size (${result.size} bytes), skipped`,
      severity: "warn",
    });
  }
  if (result.disappeared) {
    ctx.markPartial("source changed during scan");
    ctx.addWarning({
      code: "source_changed_during_scan",
      message: "Source file disappeared or changed during scan",
      severity: "warn",
    });
  }
  if (result.mode === "degraded") {
    ctx.markPartial("degraded large-file scan");
  }
  return result;
}
