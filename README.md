# logsesh

read and export ai coding agent session logs. local-first, no telemetry.

## install

```bash
npm install -g logsesh
```

from source:

```bash
pnpm install
pnpm build
pnpm dev list
```

## usage

```bash
logsesh list
logsesh search "middleware" --project myapp
logsesh stats --since 30d
logsesh export --format markdown --out session.md --redact
```

commands: `list`, `search`, `stats`, `export`, and `debug` (single-file diagnostic).

shared flags: `--tool`, `--project`, `--since`, `--until`, `--query`, `--json`, `--roots`, `--estimate-cost`, `--max-file-bytes`, `--max-turn-chars`, `--max-tool-output-chars`.

`search`: `--search-reasoning`, `--include-tool-output`, `--redact-pattern`.

`export`: `--format` (json, jsonl, markdown, csv), `--granularity`, `--summary-only`, `--out`, `--force`, `--redact`, `--redact-pattern`, `--include-reasoning`, `--no-anonymize-paths`, `--unsafe-raw`.

full flag reference: `logsesh <command> --help`.

## library

`npm install @logsesh/core` for programmatic access. schemas under `@logsesh/core/schemas/*`, pricing under `@logsesh/core/pricing/*`.

## logs

| tool | path |
|------|------|
| claude code | `~/.claude/projects/*/*.jsonl` |
| codex | `~/.codex/sessions/**/rollout-*.jsonl` |
| gemini cli | experimental |

## privacy

- no network calls at runtime
- paths anonymized in list, search, stats, and exports by default
- search snippets redacted by default; use `--redact` on exports
- reasoning excluded unless `--include-reasoning`
- `costUsd` comes from logs only; use `--estimate-cost` for labeled estimates

## requirements

node `>=22`

## development

```bash
pnpm test
pnpm verify
pnpm publish -r --dry-run --no-git-checks
```

## license

MIT
