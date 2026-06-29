import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { z } from "zod";
import { DEFAULT_MAX_FILE_BYTES } from "./constants.js";

export async function readJsonlLines(
  filePath: string,
  onLine: (line: string, lineNumber: number) => void,
  opts?: { maxFileBytes?: number },
): Promise<{ skipped: boolean; size: number }> {
  const fileStat = await stat(filePath);
  const maxBytes = opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (fileStat.size > maxBytes) {
    return { skipped: true, size: fileStat.size };
  }

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;
    if (line.trim()) onLine(line, lineNumber);
  }

  return { skipped: false, size: fileStat.size };
}

export function parseJsonLine(
  line: string,
  lineNumber: number,
  sourcePath: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(line);
    return { ok: true, value };
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Line ${lineNumber} in ${sourcePath}: ${cause}` };
  }
}

export function parseJsonLineWithSchema<S extends z.ZodType>(
  line: string,
  lineNumber: number,
  sourcePath: string,
  schema: S,
): { ok: true; value: z.infer<S> } | { ok: false; error: string } {
  const parsed = parseJsonLine(line, lineNumber, sourcePath);
  if (!parsed.ok) return parsed;
  const validated = schema.safeParse(parsed.value);
  if (!validated.success) {
    return {
      ok: false,
      error: `Line ${lineNumber} in ${sourcePath}: invalid JSON shape`,
    };
  }
  return { ok: true, value: validated.data };
}

export function decodeClaudeProjectSlug(slug: string): string {
  if (!slug.startsWith("-")) return slug;
  const parts = slug.slice(1).split("-");
  if (parts.length === 0) return slug;
  const drive = parts[0];
  const rest = parts.slice(1).join("/");
  return `/${drive}/${rest}`;
}

export function anonymizePath(path: string, home = process.env.HOME ?? ""): string {
  if (home && path.startsWith(home)) {
    return path.replace(home, "~");
  }
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

export function anonymizePathsInText(text: string, home = process.env.HOME ?? ""): string {
  let result = text;
  if (home) {
    result = result.replaceAll(home, "~");
  }
  return result.replace(/\/Users\/[^/\s'"]+/g, "~").replace(/\/home\/[^/\s'"]+/g, "~");
}

export function sessionFileNameId(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.jsonl$/, "");
}
