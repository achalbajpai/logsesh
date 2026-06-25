import type { Command } from "commander";

export function sharedOptions(cmd: Command): Command {
  return cmd
    .option("--tool <tools>", "Comma-separated tools: claude-code,codex,gemini")
    .option("--project <path>", "Filter by project path prefix")
    .option("--since <date>", "Filter sessions since (ISO date or e.g. 7d)")
    .option("--until <date>", "Filter sessions until")
    .option("--query <text>", "Filter sessions matching query terms")
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
