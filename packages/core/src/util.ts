import { posix as posixPath } from "node:path";
import type { z } from "zod";
import { BINARY_ELIDE_MIN_CHARS } from "./constants.js";
import { type JsonlReadOptions, type JsonlScanResult, readJsonl } from "./jsonl-reader.js";

export async function readJsonlLines(
  filePath: string,
  onLine: (line: string, lineNumber: number) => void,
  opts?: JsonlReadOptions,
): Promise<{ skipped: boolean; size: number } & JsonlScanResult> {
  const result = await readJsonl(
    filePath,
    (row) => {
      if (row.kind === "line") onLine(row.text, row.lineNumber);
    },
    opts,
  );
  return result;
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

export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function posixDirname(filePath: string): string {
  return posixPath.dirname(toPosixPath(filePath));
}

function posixBasename(filePath: string): string {
  return posixPath.basename(toPosixPath(filePath));
}

export function decodeClaudeProjectSlug(slug: string): string {
  if (!slug.startsWith("-")) return slug;
  const parts = slug.slice(1).split("-");
  if (parts.length === 0) return slug;
  const drive = parts[0];
  const rest = parts.slice(1).join("/");
  return `/${drive}/${rest}`;
}

export function claudeProjectSlugFromPath(filePath: string): string {
  const posix = toPosixPath(filePath);
  let dir = posixPath.dirname(posix);
  let child = posixPath.basename(posix);
  while (dir && dir !== "/" && dir !== ".") {
    if (posixPath.basename(dir) === "projects") return child;
    const parent = posixPath.dirname(dir);
    if (parent === dir) break;
    child = posixPath.basename(dir);
    dir = parent;
  }
  return posixPath.basename(posixPath.dirname(posix));
}

export function claudeSubagentFromPath(
  filePath: string,
): { parentSessionId: string; agentId: string } | undefined {
  const file = posixBasename(filePath);
  const subagentsDir = posixDirname(filePath);
  if (posixBasename(subagentsDir) !== "subagents") return undefined;
  const parentSessionId = posixBasename(posixDirname(subagentsDir));
  if (!parentSessionId || !file.startsWith("agent-") || !file.endsWith(".jsonl")) {
    return undefined;
  }
  return {
    parentSessionId,
    agentId: file.slice("agent-".length, -".jsonl".length),
  };
}

export function extractCodexSessionDate(filePath: string): Date | undefined {
  let dir = posixDirname(filePath);
  const day = posixBasename(dir);
  dir = posixDirname(dir);
  const month = posixBasename(dir);
  dir = posixDirname(dir);
  const year = posixBasename(dir);
  dir = posixDirname(dir);
  const bucket = posixBasename(dir);
  if (bucket !== "sessions" && bucket !== "archived_sessions") return undefined;
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return undefined;
  return new Date(`${year}-${month}-${day}T00:00:00Z`);
}

export function isCodexArchivedPath(filePath: string): boolean {
  let dir = posixDirname(filePath);
  while (dir && dir !== "/" && dir !== ".") {
    if (posixBasename(dir) === "archived_sessions") return true;
    const parent = posixDirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

export function anonymizePath(
  path: string,
  home = process.env.HOME ?? process.env.USERPROFILE ?? "",
): string {
  if (home && path.startsWith(home)) {
    return path.replace(home, "~");
  }
  return path
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~")
    .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, "~");
}

export function anonymizePathsInText(
  text: string,
  home = process.env.HOME ?? process.env.USERPROFILE ?? "",
): string {
  let result = text;
  if (home) {
    result = result.replaceAll(home, "~");
  }
  return result.replace(/\/Users\/[^/\s'"]+/g, "~").replace(/\/home\/[^/\s'"]+/g, "~");
}

export function sessionFileNameId(filePath: string): string {
  return posixBasename(filePath).replace(/\.jsonl$/i, "");
}

const DATA_URL_RE = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/i;
const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;

export function elideBinaryText(
  text: string,
):
  | { kind: "text"; text: string }
  | { kind: "image"; mediaType?: string; bytes?: number; note: string } {
  const dataUrl = text.match(DATA_URL_RE);
  if (dataUrl && (dataUrl[2] || (dataUrl[3]?.length ?? 0) >= BINARY_ELIDE_MIN_CHARS)) {
    const payload = dataUrl[3] ?? "";
    return {
      kind: "image",
      mediaType: dataUrl[1] || undefined,
      bytes: payload.length,
      note: "[binary content omitted]",
    };
  }
  if (text.length >= BINARY_ELIDE_MIN_CHARS && BASE64_RE.test(text) && !text.includes(" ")) {
    return {
      kind: "image",
      bytes: text.length,
      note: "[binary content omitted]",
    };
  }
  return { kind: "text", text };
}
