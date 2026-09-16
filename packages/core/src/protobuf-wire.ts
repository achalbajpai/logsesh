export type PbScalar =
  | { wire: 0; value: bigint }
  | { wire: 1; value: Uint8Array }
  | { wire: 2; value: Uint8Array }
  | { wire: 5; value: Uint8Array };

export interface PbField {
  field: number;
  value: PbScalar;
}

function readVarint(buf: Uint8Array, offset: number): { value: bigint; next: number } | undefined {
  let result = 0n;
  let shift = 0n;
  let i = offset;
  while (i < buf.length) {
    const byte = buf[i] ?? 0;
    i += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, next: i };
    shift += 7n;
    if (shift > 63n) return undefined;
  }
  return undefined;
}

export function pbFields(buf: Uint8Array): PbField[] {
  const out: PbField[] = [];
  let i = 0;
  while (i < buf.length) {
    const tag = readVarint(buf, i);
    if (!tag) break;
    const field = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    i = tag.next;
    if (wire === 0) {
      const varint = readVarint(buf, i);
      if (!varint) break;
      out.push({ field, value: { wire: 0, value: varint.value } });
      i = varint.next;
      continue;
    }
    if (wire === 1) {
      if (i + 8 > buf.length) break;
      out.push({ field, value: { wire: 1, value: buf.subarray(i, i + 8) } });
      i += 8;
      continue;
    }
    if (wire === 2) {
      const len = readVarint(buf, i);
      if (!len) break;
      i = len.next;
      const end = i + Number(len.value);
      if (!Number.isSafeInteger(Number(len.value)) || end > buf.length) break;
      out.push({ field, value: { wire: 2, value: buf.subarray(i, end) } });
      i = end;
      continue;
    }
    if (wire === 5) {
      if (i + 4 > buf.length) break;
      out.push({ field, value: { wire: 5, value: buf.subarray(i, i + 4) } });
      i += 4;
      continue;
    }
    break;
  }
  return out;
}

export function pbBytes(buf: Uint8Array, field: number): Uint8Array | undefined {
  for (const entry of pbFields(buf)) {
    if (entry.field === field && entry.value.wire === 2) return entry.value.value;
  }
  return undefined;
}

export function pbAllBytes(buf: Uint8Array, field: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const entry of pbFields(buf)) {
    if (entry.field === field && entry.value.wire === 2) out.push(entry.value.value);
  }
  return out;
}

export function pbVarint(buf: Uint8Array, field: number): number | undefined {
  for (const entry of pbFields(buf)) {
    if (entry.field === field && entry.value.wire === 0) {
      const asNumber = Number(entry.value.value);
      if (Number.isSafeInteger(asNumber)) return asNumber;
    }
  }
  return undefined;
}

export function pbUtf8(buf: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export function pbStr(buf: Uint8Array, field: number): string | undefined {
  const bytes = pbBytes(buf, field);
  return bytes ? pbUtf8(bytes) : undefined;
}

function writeVarint(value: number | bigint, out: number[]): void {
  let n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) n = 0n;
  while (n > 0x7fn) {
    out.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  out.push(Number(n));
}

export function pbEncode(
  fields: Array<{ field: number; varint?: number | bigint; bytes?: Uint8Array | string }>,
): Uint8Array {
  const out: number[] = [];
  for (const field of fields) {
    if (field.varint !== undefined) {
      writeVarint((field.field << 3) | 0, out);
      writeVarint(field.varint, out);
      continue;
    }
    if (field.bytes !== undefined) {
      const bytes =
        typeof field.bytes === "string" ? new TextEncoder().encode(field.bytes) : field.bytes;
      writeVarint((field.field << 3) | 2, out);
      writeVarint(bytes.length, out);
      for (const byte of bytes) out.push(byte);
    }
  }
  return Uint8Array.from(out);
}

export function pbTimestampIso(metaOrPayload: Uint8Array): string | undefined {
  const envelope = pbBytes(metaOrPayload, 5) ?? metaOrPayload;
  const ts = pbBytes(envelope, 1);
  if (!ts) return undefined;
  const secs = pbVarint(ts, 1);
  if (secs === undefined || secs <= 0) return undefined;
  const nanos = pbVarint(ts, 2) ?? 0;
  const millis = secs * 1000 + Math.floor(nanos / 1_000_000);
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function pbLongestUtf8(buf: Uint8Array, minLength = 8): string | undefined {
  let best: string | undefined;
  for (const entry of pbFields(buf)) {
    if (entry.value.wire !== 2) continue;
    const text = pbUtf8(entry.value.value)?.trim();
    if (!text || text.length < minLength) continue;
    if (!best || text.length > best.length) best = text;
    const nested = pbLongestUtf8(entry.value.value, minLength);
    if (nested && (!best || nested.length > best.length)) best = nested;
  }
  return best;
}
