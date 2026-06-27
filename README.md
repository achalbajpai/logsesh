# logsesh

Local-first CLI for reading, searching, and exporting AI coding-agent session logs.

No telemetry. No runtime network calls. Private paths and reasoning stay hidden by default.

## Install

```bash
npm install -g logsesh
```

From source:

```bash
pnpm install
pnpm build
pnpm dev list
```

Requires Node.js `>=22`.

## Use

```bash
logsesh list
logsesh search "middleware" --project myapp
logsesh stats --since 30d
logsesh export --format markdown --out session.md --redact
```

## Commands

| command | purpose |
| --- | --- |
| `list` | show matching sessions |
| `search` | find text across transcripts |
| `stats` | summarize activity and token usage |
| `export` | write JSON, JSONL, Markdown, or CSV |
| `debug` | inspect one log file |

Run `logsesh <command> --help` for full options.

## Sources

| tool | default location |
| --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` |
| Gemini CLI | experimental |

## Privacy Defaults

- Paths are anonymized in `list`, `search`, `stats`, and exports.
- Search snippets are redacted by default.
- Reasoning is excluded unless `--include-reasoning` is set.
- Full exports warn unless `--redact` is set.
- Logged `costUsd` is never overwritten; estimates are labeled.

## Library

```bash
npm install @logsesh/core
```

```ts
import { runPipeline, sanitizeForExport } from "@logsesh/core";

for await (const { session } of runPipeline({ toolFilter: ["codex"] })) {
  if (!session) continue;
  console.log(sanitizeForExport(session));
}
```

Schemas are published under `@logsesh/core/schemas/*`.
Pricing data is published under `@logsesh/core/pricing/*`.

## Develop

```bash
pnpm verify
pnpm publish -r --dry-run --no-git-checks
```

## License

MIT
