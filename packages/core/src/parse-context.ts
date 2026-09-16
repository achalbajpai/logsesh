import type { z } from "zod";
import { readJsonl } from "./jsonl-reader.js";
import type { JsonlReadOptions, JsonlRecordRow, JsonlRow } from "./jsonl-reader.js";
import { SessionBuilder } from "./session-builder.js";
import type {
  AddRecordInput,
  AddToolResultInput,
  AgentLineage,
  ParseOptions,
  Session,
  SessionFile,
  ToolName,
  Usage,
  Warning,
} from "./types.js";

export interface ParseContextOptions {
  tool: ToolName;
  adapterVersion: string;
  file: SessionFile;
  opts?: ParseOptions;
  sessionId: string;
  projectPath?: string;
  logFormatVersion?: string;
}

export class ParseContext {
  private readonly builder: SessionBuilder;
  private readonly file: SessionFile;
  private readonly readOpts: JsonlReadOptions;
  private readonly unknownTypes = new Map<string, number>();
  private readonly unknownBlocks = new Map<string, number>();
  private recordsStarted = false;
  private finished = false;

  constructor(options: ParseContextOptions) {
    this.file = options.file;
    this.readOpts = {
      maxFileBytes: options.opts?.maxFileBytes,
      maxRecordBytes: options.opts?.maxRecordBytes,
      largeFileMode: options.opts?.largeFileMode,
    };
    this.builder = new SessionBuilder({
      tool: options.tool,
      adapterVersion: options.adapterVersion,
      sourcePath: options.file.path,
      sessionId: options.sessionId,
      projectPath: options.projectPath,
      logFormatVersion: options.logFormatVersion,
      maxTurnChars: options.opts?.maxTurnChars,
      maxToolOutputChars: options.opts?.maxToolOutputChars,
    });
  }

  records(): AsyncIterable<JsonlRecordRow> {
    if (this.recordsStarted) {
      throw new Error("ParseContext.records() can only be consumed once");
    }
    this.recordsStarted = true;
    return this.iterateRecords();
  }

  private async *iterateRecords(): AsyncGenerator<JsonlRecordRow> {
    for await (const row of readJsonl(this.file.path, this.readOpts)) {
      this.observeRow(row);
      if (row.kind === "record") yield row;
    }
  }

  decode<S extends z.ZodType>(
    rec: JsonlRecordRow,
    schema: S,
    label: string,
  ): z.infer<S> | undefined {
    this.ensureOpen();
    const parsed = schema.safeParse(rec.json);
    if (parsed.success) return parsed.data;
    const line = rec.line ?? rec.seq;
    this.builder.addWarning({
      code: "invalid_line_shape",
      message: `Line ${line}: invalid ${label} shape`,
      severity: "warn",
      scope: "parse",
      sourcePath: this.file.path,
      line,
    });
    return undefined;
  }

  ignoreRecord(_type: string): void {
    this.ensureOpen();
  }

  unknownRecord(type: string): void {
    this.ensureOpen();
    this.builder.noteUnknownRecord();
    this.unknownTypes.set(type, (this.unknownTypes.get(type) ?? 0) + 1);
  }

  unknownBlock(type: string): void {
    this.ensureOpen();
    this.unknownBlocks.set(type, (this.unknownBlocks.get(type) ?? 0) + 1);
  }

  addRecord(input: AddRecordInput): void {
    this.ensureOpen();
    this.builder.addRecord(input);
  }

  addToolResult(input: AddToolResultInput): void {
    this.ensureOpen();
    this.builder.addToolResult(input);
  }

  addWarning(warning: Warning): void {
    this.ensureOpen();
    this.builder.addWarning(warning);
  }

  setSessionId(sessionId: string): void {
    this.ensureOpen();
    this.builder.setSessionId(sessionId);
  }

  setProjectPath(projectPath: string | undefined): void {
    this.ensureOpen();
    this.builder.setProjectPath(projectPath);
  }

  setModel(model: string | undefined): void {
    this.ensureOpen();
    this.builder.setModel(model);
  }

  setLineage(lineage: AgentLineage): void {
    this.ensureOpen();
    this.builder.setLineage(lineage);
  }

  setBranch(branch: string | undefined): void {
    this.ensureOpen();
    this.builder.setBranch(branch);
  }

  setSourceLifecycle(lifecycle: "active" | "archived"): void {
    this.ensureOpen();
    this.builder.setSourceLifecycle(lifecycle);
  }

  setLogFormatVersion(version: string | undefined): void {
    this.ensureOpen();
    this.builder.setLogFormatVersion(version);
  }

  observeUsage(input: { mode: "delta" | "cumulative"; usage: Usage; key?: string }): void {
    this.ensureOpen();
    this.builder.observeUsage(input);
  }

  observeSequence(ordinal: number): void {
    this.ensureOpen();
    this.builder.observeSequence(ordinal);
  }

  markPartial(reason: string): void {
    this.ensureOpen();
    this.builder.markPartial(reason);
  }

  finish(): Session {
    if (this.finished) return this.builder.finalize();
    this.emitUnknownSummaries();
    this.finished = true;
    return this.builder.finalize();
  }

  private observeRow(row: JsonlRow): void {
    this.ensureOpen();
    switch (row.kind) {
      case "record":
        this.builder.noteObservedRecord();
        return;
      case "oversized": {
        this.builder.noteOversizedRecord();
        this.builder.markPartial("oversized_record");
        const line = row.line ?? row.seq;
        this.builder.addWarning({
          code: "oversized_record",
          message: `Record exceeds max size (${row.bytes} bytes)`,
          severity: "warn",
          scope: "parse",
          sourcePath: this.file.path,
          line,
        });
        return;
      }
      case "malformed": {
        this.builder.noteMalformedRecord();
        this.builder.markPartial("malformed_line");
        const line = row.line ?? row.seq;
        this.builder.addWarning({
          code: "malformed_line",
          message: `Line ${line}: ${row.cause}`,
          severity: "warn",
          scope: "parse",
          sourcePath: this.file.path,
          line,
        });
        return;
      }
      case "gap":
        if (row.reason === "whole-file-skip") {
          this.builder.markWholeFileSkip();
          this.builder.addWarning({
            code: "file_too_large",
            message: `File exceeds max size (${row.bytes} bytes), skipped`,
            severity: "warn",
            scope: "parse",
            sourcePath: this.file.path,
          });
          return;
        }
        this.builder.markPartial("partial_large_file");
        this.builder.addWarning({
          code: "partial_large_file",
          message: `Large file parsed from head and tail only (${row.bytes} bytes skipped)`,
          severity: "warn",
          scope: "parse",
          sourcePath: this.file.path,
        });
        return;
      default: {
        const _exhaustive: never = row;
        return _exhaustive;
      }
    }
  }

  private emitUnknownSummaries(): void {
    if (this.unknownTypes.size > 0) {
      const cause = formatCounts(this.unknownTypes);
      this.builder.addWarning({
        code: "unknown_record_type",
        message: `Unknown record types: ${cause}`,
        severity: "info",
        scope: "parse",
        sourcePath: this.file.path,
        cause,
      });
    }
    if (this.unknownBlocks.size > 0) {
      const cause = formatCounts(this.unknownBlocks);
      this.builder.addWarning({
        code: "unknown_content_block",
        message: `Unknown content blocks: ${cause}`,
        severity: "info",
        scope: "parse",
        sourcePath: this.file.path,
        cause,
      });
    }
  }

  private ensureOpen(): void {
    if (this.finished) {
      throw new Error("ParseContext cannot be mutated after finish()");
    }
  }
}

function formatCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, n]) => `${type}:${n}`)
    .join(", ");
}
