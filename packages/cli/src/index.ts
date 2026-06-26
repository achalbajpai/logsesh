#!/usr/bin/env node
import type { ToolName } from "@logsesh/core";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDebug } from "./commands/debug.js";
import { runExport } from "./commands/export.js";
import { runList } from "./commands/list.js";
import { runSearch } from "./commands/search.js";
import { runStats } from "./commands/stats.js";
import { collect, sharedOptions } from "./util/shared-options.js";
import { parseToolName } from "./util/format.js";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as { version: string };

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("logsesh")
    .description("Local-first AI coding agent session log reader")
    .version(pkg.version);

  sharedOptions(program.command("list").description("List sessions")).action(async (opts) => {
    process.exit(await runList(opts));
  });

  sharedOptions(
    program
      .command("search")
      .description("Search session transcripts")
      .argument("<query>", "Search query")
      .option("--search-reasoning", "Include reasoning/thinking in search")
      .option("--include-tool-output", "Include tool output in search")
      .option("--redact-pattern <regex>", "Additional redaction pattern", collect, []),
  ).action(async (searchQuery, opts) => {
    process.exit(
      await runSearch({
        ...opts,
        searchQuery,
        includeReasoning: opts.searchReasoning,
      }),
    );
  });

  sharedOptions(program.command("stats").description("Aggregate session statistics")).action(
    async (opts) => {
      process.exit(await runStats(opts));
    },
  );

  sharedOptions(
    program
      .command("export")
      .description("Export sessions")
      .requiredOption("--format <fmt>", "json|jsonl|markdown|csv")
      .option("--granularity <g>", "session|turn", "session")
      .option("--summary-only", "Export summary rows only (csv)")
      .option("--out <file>", "Output file (stdout if omitted)")
      .option("--force", "Overwrite existing output file")
      .option("--redact", "Redact secrets")
      .option("--redact-pattern <regex>", "Additional redaction pattern", collect, [])
      .option("--include-reasoning", "Include reasoning in export (sensitive)")
      .option("--no-anonymize-paths", "Keep raw paths in export")
      .option("--unsafe-raw", "Disable markdown injection neutralization"),
  ).action(async (opts) => {
    process.exit(await runExport(opts));
  });

  program
    .command("debug", { hidden: true })
    .description("Normalize a single log file (local diagnostic)")
    .argument("<file>", "Path to log file")
    .option("--tool <tool>", "Tool name (auto-detected when omitted)")
    .option("--json", "Emit DebugEnvelope JSON")
    .option("--max-file-bytes <n>", "Max file bytes", parseInt)
    .option("--max-turn-chars <n>", "Max turn chars", parseInt)
    .option("--max-tool-output-chars <n>", "Max tool output chars", parseInt)
    .action(async (file, opts) => {
      let tool: ToolName | undefined;
      if (opts.tool) {
        const parsed = parseToolName(String(opts.tool));
        if (parsed.error) {
          console.error(parsed.error);
          process.exit(2);
        }
        tool = parsed.tool;
      }
      process.exit(
        await runDebug({
          file,
          tool,
          json: opts.json,
          maxFileBytes: opts.maxFileBytes,
          maxTurnChars: opts.maxTurnChars,
          maxToolOutputChars: opts.maxToolOutputChars,
        }),
      );
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
