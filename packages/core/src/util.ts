import path from "node:path";

export function decodeClaudeProjectSlug(slug: string): string {
  if (!slug.startsWith("-")) return slug;
  const parts = slug.slice(1).split("-");
  if (parts.length === 0) return slug;
  const drive = parts[0];
  const rest = parts.slice(1).join("/");
  return `/${drive}/${rest}`;
}

export function anonymizePath(filePath: string, home = process.env.HOME ?? ""): string {
  if (home && filePath.startsWith(home)) {
    return filePath.replace(home, "~");
  }
  return filePath.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

export function anonymizePathsInText(text: string, home = process.env.HOME ?? ""): string {
  let result = text;
  if (home) {
    result = result.replaceAll(home, "~");
  }
  return result.replace(/\/Users\/[^/\s'"]+/g, "~").replace(/\/home\/[^/\s'"]+/g, "~");
}

export function sessionFileNameId(filePath: string): string {
  const base = path.posix.basename(filePath.replace(/\\/g, "/"));
  return base.replace(/\.jsonl$/i, "");
}

export function parentDirName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return path.posix.basename(path.posix.dirname(normalized));
}
