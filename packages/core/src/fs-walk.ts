import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ToolName, Warning } from "./types.js";

export async function* walkFiles(
  dir: string,
  match: (path: string, name: string, isDirectory: boolean) => boolean,
  visited: Set<string> = new Set(),
): AsyncGenerator<string> {
  let realDir: string;
  try {
    realDir = await realpath(dir);
  } catch {
    return;
  }
  if (visited.has(realDir)) return;
  visited.add(realDir);

  let entries: string[];
  try {
    entries = await readdir(realDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(realDir, entry);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (match(full, entry, true)) {
        yield* walkFiles(full, match, visited);
      }
    } else if (match(full, entry, false)) {
      yield full;
    }
  }
}

export async function detectRootAccess(
  root: string,
  tool: ToolName,
): Promise<{ accessible: boolean; warning?: Warning }> {
  try {
    const { access } = await import("node:fs/promises");
    await access(root);
    return { accessible: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return {
        accessible: false,
        warning: {
          code: "discovery_permission",
          message: `Permission denied reading ${tool} logs at ${root}`,
          severity: "warn",
          scope: "discovery",
          sourcePath: root,
          cause: code,
        },
      };
    }
    return { accessible: false };
  }
}
