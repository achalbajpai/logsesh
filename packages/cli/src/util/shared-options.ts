import type { Command } from "commander";

export function sharedOptions(cmd: Command): Command {
  return cmd
    .option("--tool <tools>", "Comma-separated tools: claude-code,codex,gemini")
    .option(
      "--project <name>",
      "Filter by project path or directory name (same as project:name in --query)",
      collect,
      [],
    )
    .option("--since <date>", "Filter sessions since (ISO date or e.g. 7d)")
    .option("--until <date>", "Filter sessions until")
    .option(
      "--query <text>",
      'Filter sessions (e.g. auth, project:myapp, project:myapp AND "rate limit")',
    )
    .option("--json", "Machine-readable JSON output")
    .option("--estimate-cost", "Show estimated cost (never replaces canonical costUsd)")
    .option("--max-file-bytes <n>", "Skip files larger than N bytes", parseInt)
    .option("--max-turn-chars <n>", "Truncate turn text at N characters", parseInt)
    .option("--max-tool-output-chars <n>", "Truncate tool output at N characters", parseInt)
    .option("--roots <spec>", "Override log roots as tool:path (repeatable)", collect, []);
}

export function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}
