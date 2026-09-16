import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import {
  DEFAULT_DEGRADED_HEAD_BYTES,
  DEFAULT_DEGRADED_TAIL_BYTES,
  DEFAULT_LARGE_FILE_THRESHOLD,
  DEFAULT_MAX_RECORD_BYTES,
} from "./constants.js";

export type JsonlRow =
  | { kind: "record"; seq: number; line?: number; offset: number; bytes: number; json: unknown }
  | { kind: "oversized"; seq: number; line?: number; offset: number; bytes: number }
  | { kind: "malformed"; seq: number; line?: number; offset: number; bytes: number; cause: string }
  | {
      kind: "gap";
      seq: number;
      offset: number;
      bytes: number;
      reason: "degraded-middle" | "whole-file-skip";
    };

export type JsonlRecordRow = Extract<JsonlRow, { kind: "record" }>;

export interface JsonlReadOptions {
  maxFileBytes?: number;
  maxRecordBytes?: number;
  largeFileMode?: "auto" | "degraded" | "full";
  headBytes?: number;
  tailBytes?: number;
  largeFileThreshold?: number;
  chunkSize?: number;
}

export type ReadPlan =
  | { kind: "skip"; fileBytes: number }
  | { kind: "full"; fileBytes: number }
  | {
      kind: "degraded";
      fileBytes: number;
      headBytes: number;
      tailBytes: number;
      tailStart: number;
    };

const LF = 0x0a;
const CR = 0x0d;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const DEFAULT_CHUNK_SIZE = 64 * 1024;

export function planRead(fileBytes: number, opts: JsonlReadOptions = {}): ReadPlan {
  if (opts.maxFileBytes !== undefined && fileBytes > opts.maxFileBytes) {
    return { kind: "skip", fileBytes };
  }

  const mode = opts.largeFileMode ?? "auto";
  if (mode === "full") {
    return { kind: "full", fileBytes };
  }

  const headBytes = opts.headBytes ?? DEFAULT_DEGRADED_HEAD_BYTES;
  const tailBytes = opts.tailBytes ?? DEFAULT_DEGRADED_TAIL_BYTES;
  const threshold = opts.largeFileThreshold ?? DEFAULT_LARGE_FILE_THRESHOLD;
  const degraded = mode === "degraded" || fileBytes > threshold;
  if (!degraded || fileBytes <= headBytes + tailBytes) {
    return { kind: "full", fileBytes };
  }

  return {
    kind: "degraded",
    fileBytes,
    headBytes,
    tailBytes,
    tailStart: fileBytes - tailBytes,
  };
}

export async function* readJsonl(
  filePath: string,
  opts: JsonlReadOptions = {},
): AsyncIterable<JsonlRow> {
  const file = await open(filePath, "r");
  try {
    const fileBytes = (await file.stat()).size;
    const plan = planRead(fileBytes, opts);
    const maxRecordBytes = opts.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
    const chunkSize = Math.max(1, opts.chunkSize ?? DEFAULT_CHUNK_SIZE);
    const cursor = { seq: 1 };

    if (plan.kind === "skip") {
      yield {
        kind: "gap",
        seq: cursor.seq,
        offset: 0,
        bytes: plan.fileBytes,
        reason: "whole-file-skip",
      };
      return;
    }

    if (plan.kind === "full") {
      yield* scanRange(file, {
        start: 0,
        fileBytes,
        stopStartingLinesAt: undefined,
        linesKnown: true,
        flushIncomplete: true,
        maxRecordBytes,
        chunkSize,
        cursor,
      });
      return;
    }

    const headEnd = { offset: 0 };
    yield* scanRange(
      file,
      {
        start: 0,
        fileBytes,
        stopStartingLinesAt: plan.headBytes,
        linesKnown: true,
        flushIncomplete: false,
        maxRecordBytes,
        chunkSize,
        cursor,
      },
      (offset) => {
        headEnd.offset = offset;
      },
    );

    const dropped = await dropPartialLine(file, plan.tailStart, fileBytes);
    const gapStart = headEnd.offset;
    const gapEnd = plan.tailStart + dropped;
    const gapBytes = Math.max(0, gapEnd - gapStart);
    if (gapBytes > 0) {
      yield {
        kind: "gap",
        seq: cursor.seq,
        offset: gapStart,
        bytes: gapBytes,
        reason: "degraded-middle",
      };
      cursor.seq += 1;
    }

    yield* scanRange(file, {
      start: plan.tailStart + dropped,
      fileBytes,
      stopStartingLinesAt: undefined,
      linesKnown: false,
      flushIncomplete: true,
      maxRecordBytes,
      chunkSize,
      cursor,
    });
  } finally {
    await file.close();
  }
}

interface ScanCursor {
  seq: number;
}

interface ScanOptions {
  start: number;
  fileBytes: number;
  stopStartingLinesAt: number | undefined;
  linesKnown: boolean;
  flushIncomplete: boolean;
  maxRecordBytes: number;
  chunkSize: number;
  cursor: ScanCursor;
}

async function* scanRange(
  file: FileHandle,
  opts: ScanOptions,
  onOffset?: (nextOffset: number) => void,
): AsyncIterable<JsonlRow> {
  const scanner = new LineScanner(opts);
  const readBuf = Buffer.alloc(opts.chunkSize);
  let pos = opts.start;

  while (pos < opts.fileBytes) {
    if (scanner.shouldStopStarting(scanner.pendingStart)) break;

    const toRead = Math.min(readBuf.length, opts.fileBytes - pos);
    const { bytesRead } = await file.read(readBuf, 0, toRead, pos);
    if (bytesRead === 0) break;

    yield* scanner.push(Buffer.from(readBuf.subarray(0, bytesRead)));
    pos += bytesRead;
  }

  yield* scanner.finish(opts.flushIncomplete);
  onOffset?.(scanner.pendingStart);
}

class LineScanner {
  pendingStart: number;
  private parts: Buffer[] = [];
  private partsLen = 0;
  private discarding = false;
  private discardOffset = 0;
  private discardBytes = 0;
  private lineNumber: number | undefined;
  private stripBom: boolean;

  constructor(private readonly opts: ScanOptions) {
    this.pendingStart = opts.start;
    this.lineNumber = opts.linesKnown ? 1 : undefined;
    this.stripBom = opts.start === 0;
  }

  shouldStopStarting(offset: number): boolean {
    return (
      !this.discarding &&
      this.partsLen === 0 &&
      this.opts.stopStartingLinesAt !== undefined &&
      offset >= this.opts.stopStartingLinesAt
    );
  }

  *push(chunk: Buffer): Iterable<JsonlRow> {
    let from = 0;
    while (from < chunk.length) {
      if (this.shouldStopStarting(this.pendingStart) && this.partsLen === 0 && !this.discarding) {
        return;
      }

      const nl = chunk.indexOf(LF, from);
      if (nl === -1) {
        this.addBytes(chunk.subarray(from));
        return;
      }

      this.addBytes(chunk.subarray(from, nl));
      const physicalBytes = this.discarding ? this.discardBytes : this.partsLen;
      yield* this.finishLine(physicalBytes);
      from = nl + 1;
      this.pendingStart += physicalBytes + 1;
    }
  }

  *finish(flushIncomplete: boolean): Iterable<JsonlRow> {
    if (this.discarding) {
      yield this.emitOversized(this.discardOffset, this.discardBytes);
      this.discarding = false;
      this.discardBytes = 0;
      return;
    }
    if (this.partsLen === 0) return;
    if (!flushIncomplete) {
      this.parts = [];
      this.partsLen = 0;
      return;
    }
    const physicalBytes = this.partsLen;
    yield* this.finishLine(physicalBytes);
    this.pendingStart += physicalBytes;
  }

  private addBytes(piece: Buffer): void {
    if (piece.length === 0) return;
    if (this.discarding) {
      this.discardBytes += piece.length;
      return;
    }
    this.parts.push(Buffer.from(piece));
    this.partsLen += piece.length;
    if (this.partsLen > this.opts.maxRecordBytes) {
      this.discarding = true;
      this.discardOffset = this.pendingStart;
      this.discardBytes = this.partsLen;
      this.parts = [];
      this.partsLen = 0;
    }
  }

  private *finishLine(physicalBytes: number): Iterable<JsonlRow> {
    if (this.discarding) {
      yield this.emitOversized(this.discardOffset, this.discardBytes);
      this.discarding = false;
      this.discardBytes = 0;
      return;
    }
    if (physicalBytes > this.opts.maxRecordBytes) {
      yield this.emitOversized(this.pendingStart, physicalBytes);
      this.parts = [];
      this.partsLen = 0;
      return;
    }
    const raw = this.takeParts();
    const row = this.emitParsed(raw, this.pendingStart, physicalBytes);
    if (row) yield row;
  }

  private takeParts(): Buffer {
    if (this.parts.length === 0) return Buffer.alloc(0);
    if (this.parts.length === 1) {
      const only = this.parts[0]!;
      this.parts = [];
      this.partsLen = 0;
      return only;
    }
    const out = Buffer.concat(this.parts, this.partsLen);
    this.parts = [];
    this.partsLen = 0;
    return out;
  }

  private emitParsed(raw: Buffer, offset: number, physicalBytes: number): JsonlRow | undefined {
    let bytes = raw;
    if (
      this.stripBom &&
      offset === 0 &&
      bytes.length >= 3 &&
      bytes.subarray(0, 3).equals(UTF8_BOM)
    ) {
      bytes = bytes.subarray(3);
    }
    this.stripBom = false;
    if (bytes.length > 0 && bytes[bytes.length - 1] === CR) {
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    const loc = this.location();
    if (bytes.length === 0 || isBlank(bytes)) {
      this.advance();
      return undefined;
    }
    const text = bytes.toString("utf8");
    try {
      const json: unknown = JSON.parse(text);
      const row: JsonlRow = {
        kind: "record",
        seq: loc.seq,
        offset,
        bytes: physicalBytes,
        json,
      };
      if (loc.line !== undefined) row.line = loc.line;
      this.advance();
      return row;
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      const row: JsonlRow = {
        kind: "malformed",
        seq: loc.seq,
        offset,
        bytes: physicalBytes,
        cause,
      };
      if (loc.line !== undefined) row.line = loc.line;
      this.advance();
      return row;
    }
  }

  private emitOversized(offset: number, byteLength: number): JsonlRow {
    const loc = this.location();
    const row: JsonlRow = {
      kind: "oversized",
      seq: loc.seq,
      offset,
      bytes: byteLength,
    };
    if (loc.line !== undefined) row.line = loc.line;
    this.advance();
    return row;
  }

  private location(): { seq: number; line?: number } {
    if (this.lineNumber === undefined) return { seq: this.opts.cursor.seq };
    return { seq: this.opts.cursor.seq, line: this.lineNumber };
  }

  private advance(): void {
    this.opts.cursor.seq += 1;
    if (this.lineNumber !== undefined) this.lineNumber += 1;
  }
}

function isBlank(bytes: Buffer): boolean {
  for (const b of bytes) {
    if (b !== 0x20 && b !== 0x09 && b !== CR) return false;
  }
  return true;
}

async function dropPartialLine(
  file: FileHandle,
  tailStart: number,
  fileBytes: number,
): Promise<number> {
  if (tailStart <= 0 || tailStart >= fileBytes) return 0;

  const prev = Buffer.alloc(1);
  const prevRead = await file.read(prev, 0, 1, tailStart - 1);
  if (prevRead.bytesRead === 1 && prev[0] === LF) {
    return 0;
  }

  const buf = Buffer.alloc(Math.min(64 * 1024, Math.max(1, fileBytes - tailStart)));
  let pos = tailStart;
  let counted = 0;
  while (pos < fileBytes) {
    const { bytesRead } = await file.read(buf, 0, Math.min(buf.length, fileBytes - pos), pos);
    if (bytesRead === 0) break;
    const nl = buf.subarray(0, bytesRead).indexOf(LF);
    if (nl !== -1) return counted + nl + 1;
    counted += bytesRead;
    pos += bytesRead;
  }
  return fileBytes - tailStart;
}
