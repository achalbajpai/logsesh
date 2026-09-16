import { homedir } from "node:os";
import { join } from "node:path";

export const INDEX_SCHEMA_VERSION = 1;
export const INDEX_FILENAME = "index-v1.sqlite";

export function defaultIndexPath(): string {
  if (process.env.LOGSESH_INDEX_PATH) return process.env.LOGSESH_INDEX_PATH;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "logsesh", INDEX_FILENAME);
  }
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, "logsesh", "Cache", INDEX_FILENAME);
  }
  const xdg = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(xdg, "logsesh", INDEX_FILENAME);
}
