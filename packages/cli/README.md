# logsesh

CLI for reading, searching, summarizing, and exporting local AI coding-agent logs.

No telemetry. No runtime network calls. Private paths and reasoning stay hidden by default.

## Install

From source (not on npm yet):

```bash
git clone https://github.com/achalbajpai/logsesh.git
cd logsesh
pnpm install
pnpm build
pnpm dev doctor
```

Requires Node.js `>=22`.

## Start here

```bash
logsesh doctor
```

Checks log discovery, adapter health, and the bundled pricing table.

## Use

```bash
logsesh list
logsesh search 'project:myapp auth middleware'
logsesh stats --since 30d --estimate-cost
logsesh export --format markdown --since 30d --out sessions.md
```

Transcript exports are **redacted by default**. To export full transcript text, opt in explicitly:

```bash
logsesh export --format json --since 30d --allow-sensitive --out raw.json
```

## Commands

| command | purpose |
| --- | --- |
| `doctor` | check log access, adapters, and pricing table |
| `list` | show matching sessions |
| `search` | find text across transcripts (with snippets) |
| `stats` | summarize activity, tokens, and cost |
| `export` | write JSON, JSONL, Markdown, or CSV |

Run `logsesh <command> --help` for all options.

## Export safety

Transcript exports (`json`, `jsonl`, `markdown`, turn-level output) redact sensitive patterns **by default**.

| flag | effect |
| --- | --- |
| *(default)* | redact secrets/patterns; anonymize paths |
| `--allow-sensitive` / `--no-redact` | full transcript text |
| `--redact-pattern <regex>` | add custom redaction pattern (repeatable) |
| `--include-reasoning` | include thinking/reasoning blocks (sensitive) |
| `--no-anonymize-paths` | keep raw filesystem paths |
| `--unsafe-raw` | disable markdown injection neutralization |

Summary-only CSV follows the same path anonymization defaults. Pass `--redact` to apply pattern redaction to summary rows too.

## Privacy

- Paths are anonymized in human output for `list`, `search`, and `stats`.
- Search snippets are redacted by default.
- Reasoning is excluded unless `--include-reasoning` or `--search-reasoning` is set.
- Export redaction is on by default; use `--allow-sensitive` to opt out.

## License

MIT
