import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import {
  DEFAULT_DEGRADED_HEAD_BYTES,
  DEFAULT_DEGRADED_TAIL_BYTES,
  DEFAULT_LARGE_FILE_THRESHOLD,
  DEFAULT_MAX_RECORD_BYTES,
  DEFAULT_READER_CHUNK_BYTES,
} from "./constants.js";

import type { LargeFileMode } from "./types.js";

export type { LargeFileMode };

export interface JsonlReadOptions {
  /** When set, files larger than this are skipped entirely (v0.2 compatibility). */
  maxFileBytes?: number;
  maxRecordBytes?: number;
  largeFileMode?: LargeFileMode;
  largeFileThreshold?: number;
  headBytes?: number;
  tailBytes?: number;
  chunkBytes?: number;
}

export type JsonlRow =
  | {
      kind: "line";
      lineNumber: number;
      text: string;
      byteOffset: number;
      byteLength: number;
    }
  | {
      kind: "oversized";
      lineNumber: number;
      byteOffset: number;
      byteLength: number;
    }
  | { kind: "gap"; skippedBytes: number };

export interface JsonlScanResult {
  skipped: boolean;
  size: number;
  mode: "skip" | "full" | "degraded";
  bytesObserved: number;
  bytesParsed: number;
  disappeared: boolean;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface JsonlScanPlan {
  mode: "skip" | "full" | "degraded";
  ranges: ByteRange[];
}

export function planJsonlScan(fileBytes: number, opts: JsonlReadOptions = {}): JsonlScanPlan {
  if (opts.maxFileBytes !== undefined && fileBytes > opts.maxFileBytes) {
    return { mode: "skip", ranges: [] };
  }

  const mode = opts.largeFileMode ?? "auto";
  const threshold = opts.largeFileThreshold ?? DEFAULT_LARGE_FILE_THRESHOLD;
  const headBytes = opts.headBytes ?? DEFAULT_DEGRADED_HEAD_BYTES;
  const tailBytes = opts.tailBytes ?? DEFAULT_DEGRADED_TAIL_BYTES;

  if (mode === "full" || fileBytes <= threshold || (mode === "auto" && fileBytes <= threshold)) {
    return { mode: "full", ranges: fileBytes > 0 ? [{ start: 0, end: fileBytes }] : [] };
  }

  if (mode === "degraded" || (mode === "auto" && fileBytes > threshold)) {
    const headEnd = Math.min(fileBytes, headBytes);
    const tailStart = Math.max(0, fileBytes - tailBytes);
    if (tailStart <= headEnd) {
      return { mode: "full", ranges: [{ start: 0, end: fileBytes }] };
    }
    return {
      mode: "degraded",
      ranges: [
        { start: 0, end: headEnd },
        { start: tailStart, end: fileBytes },
      ],
    };
  }

  return { mode: "full", ranges: fileBytes > 0 ? [{ start: 0, end: fileBytes }] : [] };
}

function findNewline(buffer: Buffer, from: number): number {
  return buffer.indexOf(0x0a, from);
}

function stripCR(line: Buffer): Buffer {
  if (line.length > 0 && line[line.length - 1] === 0x0d) {
    return line.subarray(0, line.length - 1);
  }
  return line;
}

interface ScanState {
  leftover: Buffer;
  discarding: boolean;
  discardOffset: number;
  discardBytes: number;
  lineNumber: number;
  bytesParsed: number;
  bytesObserved: number;
}

function emptyState(): ScanState {
  return {
    leftover: Buffer.alloc(0),
    discarding: false,
    discardOffset: 0,
    discardBytes: 0,
    lineNumber: 0,
    bytesParsed: 0,
    bytesObserved: 0,
  };
}

function emitLine(
  state: ScanState,
  line: Buffer,
  byteOffset: number,
  onRow: (row: JsonlRow) => void,
  maxRecordBytes: number,
): void {
  state.lineNumber += 1;
  const trimmed = stripCR(line);
  if (trimmed.length > maxRecordBytes) {
    onRow({
      kind: "oversized",
      lineNumber: state.lineNumber,
      byteOffset,
      byteLength: trimmed.length,
    });
    return;
  }
  if (trimmed.length === 0) return;
  state.bytesParsed += trimmed.length;
  onRow({
    kind: "line",
    lineNumber: state.lineNumber,
    text: trimmed.toString("utf8"),
    byteOffset,
    byteLength: trimmed.length,
  });
}

function consumeBuffer(
  state: ScanState,
  data: Buffer,
  rangeStart: number,
  dataStartInFile: number,
  onRow: (row: JsonlRow) => void,
  maxRecordBytes: number,
  skipFirstPartial: boolean,
): { rest: Buffer; skipFirstPartial: boolean } {
  let offset = 0;
  let skipPartial = skipFirstPartial;

  while (offset < data.length) {
    if (state.discarding) {
      const nl = findNewline(data, offset);
      if (nl < 0) {
        state.discardBytes += data.length - offset;
        return { rest: Buffer.alloc(0), skipFirstPartial: false };
      }
      state.discardBytes += nl - offset + 1;
      state.lineNumber += 1;
      onRow({
        kind: "oversized",
        lineNumber: state.lineNumber,
        byteOffset: state.discardOffset,
        byteLength: state.discardBytes,
      });
      state.discarding = false;
      state.discardBytes = 0;
      offset = nl + 1;
      skipPartial = false;
      continue;
    }

    const nl = findNewline(data, offset);
    if (nl < 0) {
      const rest = data.subarray(offset);
      if (rest.length > maxRecordBytes) {
        state.discarding = true;
        state.discardOffset = dataStartInFile + offset;
        state.discardBytes = rest.length;
        return { rest: Buffer.alloc(0), skipFirstPartial: false };
      }
      return { rest, skipFirstPartial: skipPartial };
    }

    const line = data.subarray(offset, nl);
    const absOffset = dataStartInFile + offset;
    offset = nl + 1;

    if (skipPartial && rangeStart > 0 && state.leftover.length === 0) {
      skipPartial = false;
      continue;
    }
    skipPartial = false;
    emitLine(state, line, absOffset, onRow, maxRecordBytes);
  }

  return { rest: Buffer.alloc(0), skipFirstPartial: skipPartial };
}

async function scanRange(
  handle: FileHandle,
  range: ByteRange,
  state: ScanState,
  onRow: (row: JsonlRow) => void,
  opts: { maxRecordBytes: number; chunkBytes: number; emitTrailingIncomplete: boolean },
): Promise<boolean> {
  const chunk = Buffer.alloc(opts.chunkBytes);
  let pos = range.start;
  let skipFirstPartial = false;
  if (range.start > 0) {
    const prev = Buffer.alloc(1);
    const { bytesRead } = await handle.read(prev, 0, 1, range.start - 1);
    skipFirstPartial = bytesRead === 1 && prev[0] !== 0x0a;
  }
  state.leftover = Buffer.alloc(0);
  state.discarding = false;
  state.discardBytes = 0;

  while (pos < range.end) {
    const toRead = Math.min(opts.chunkBytes, range.end - pos);
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(chunk, 0, toRead, pos));
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String(err.code) : "";
      if (code === "ENOENT") return false;
      throw err;
    }
    if (bytesRead === 0) break;

    const piece = chunk.subarray(0, bytesRead);
    state.bytesObserved += bytesRead;
    const data = state.leftover.length > 0 ? Buffer.concat([state.leftover, piece]) : piece;
    const dataStartInFile = pos - state.leftover.length;
    const consumed = consumeBuffer(
      state,
      data,
      range.start,
      dataStartInFile,
      onRow,
      opts.maxRecordBytes,
      skipFirstPartial,
    );
    skipFirstPartial = consumed.skipFirstPartial;
    state.leftover = consumed.rest.length > 0 ? Buffer.from(consumed.rest) : Buffer.alloc(0);
    pos += bytesRead;
  }

  if (state.discarding) {
    state.lineNumber += 1;
    onRow({
      kind: "oversized",
      lineNumber: state.lineNumber,
      byteOffset: state.discardOffset,
      byteLength: state.discardBytes + state.leftover.length,
    });
    state.leftover = Buffer.alloc(0);
    state.discarding = false;
    return true;
  }

  if (state.leftover.length > 0 && !skipFirstPartial && opts.emitTrailingIncomplete) {
    const absOffset = range.end - state.leftover.length;
    emitLine(state, state.leftover, absOffset, onRow, opts.maxRecordBytes);
  }
  state.leftover = Buffer.alloc(0);

  return true;
}

export async function readJsonl(
  filePath: string,
  onRow: (row: JsonlRow) => void,
  opts: JsonlReadOptions = {},
): Promise<JsonlScanResult> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") {
      return {
        skipped: true,
        size: 0,
        mode: "skip",
        bytesObserved: 0,
        bytesParsed: 0,
        disappeared: true,
      };
    }
    throw err;
  }

  const plan = planJsonlScan(fileStat.size, opts);
  if (plan.mode === "skip") {
    return {
      skipped: true,
      size: fileStat.size,
      mode: "skip",
      bytesObserved: 0,
      bytesParsed: 0,
      disappeared: false,
    };
  }

  const maxRecordBytes = opts.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
  const chunkBytes = opts.chunkBytes ?? DEFAULT_READER_CHUNK_BYTES;
  const state = emptyState();
  let disappeared = false;

  const handle = await open(filePath, "r");
  try {
    for (let i = 0; i < plan.ranges.length; i++) {
      const range = plan.ranges[i]!;
      if (i > 0) {
        const prev = plan.ranges[i - 1]!;
        const skippedBytes = range.start - prev.end;
        if (skippedBytes > 0) onRow({ kind: "gap", skippedBytes });
      }
      const ok = await scanRange(handle, range, state, onRow, {
        maxRecordBytes,
        chunkBytes,
        emitTrailingIncomplete: range.end >= fileStat.size,
      });
      if (!ok) {
        disappeared = true;
        break;
      }
    }
  } finally {
    await handle.close();
  }

  return {
    skipped: false,
    size: fileStat.size,
    mode: plan.mode,
    bytesObserved: state.bytesObserved,
    bytesParsed: state.bytesParsed,
    disappeared,
  };
}
