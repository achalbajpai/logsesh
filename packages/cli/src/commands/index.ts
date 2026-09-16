import { buildIndex, clearIndex } from "../store/build.js";
import { defaultIndexPath } from "../store/paths.js";
import { getIndexStatus } from "../store/status.js";
import { resolvePipelineOptions } from "../util/pipeline-options.js";
import type { SharedCommandOptions } from "../util/options.js";
import { anonymizePath } from "@logsesh/core";

export async function runIndexCommand(
  action: "build" | "status" | "clear" | "path",
  opts: SharedCommandOptions & { rebuild?: boolean },
): Promise<number> {
  const dbPath = defaultIndexPath();

  if (action === "path") {
    console.log(dbPath);
    return 0;
  }

  if (action === "clear") {
    const result = await clearIndex(dbPath);
    console.log(result.existed ? `Removed ${result.dbPath}` : `No index at ${result.dbPath}`);
    return 0;
  }

  if (action === "status") {
    const status = await getIndexStatus(dbPath);
    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
      return status.broken ? 2 : 0;
    }
    console.log("LOGSESH INDEX");
    console.log(`Database   ${anonymizePath(status.dbPath)}`);
    console.log(`SQLite     ${status.sqlite ? "yes" : "no"}`);
    console.log(`FTS5       ${status.fts ? "yes" : "no"}`);
    if (status.broken) {
      console.log("Status     BROKEN");
      if (status.error) console.log(`Error      ${status.error}`);
      console.log("next: logsesh index clear && logsesh index build");
      return 2;
    }
    if (!status.available) {
      console.log("Status     missing");
      console.log("next: logsesh index build");
      return 0;
    }
    console.log(`Sources    ${status.sources}`);
    console.log(`Sessions   ${status.sessions}`);
    console.log(`Last build ${status.lastBuild ?? "unknown"}`);
    return 0;
  }

  const resolved = resolvePipelineOptions(opts);
  if (!resolved.ok) {
    console.error(resolved.error);
    return 2;
  }

  const result = await buildIndex({
    ...resolved.pipeline,
    rebuild: opts.rebuild,
    indexPath: dbPath,
  });
  if (opts.json) {
    console.log(JSON.stringify({ ...result, dbPath: anonymizePath(result.dbPath) }, null, 2));
  } else {
    if (result.error) console.error(result.error);
    console.log(`Indexed ${result.sessions} session(s) from ${result.sources} source(s)`);
    if (result.skippedUnchanged) console.log(`Unchanged ${result.skippedUnchanged}`);
    if (result.failed) console.log(`Failed    ${result.failed}`);
    console.log(`FTS5      ${result.fts ? "yes" : "no"}`);
    console.log(`Database  ${anonymizePath(result.dbPath)}`);
  }
  return result.ok ? 0 : 2;
}
