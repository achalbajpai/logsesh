# logsesh

CLI for reading, searching, summarizing, and exporting local AI coding-agent logs.

No telemetry. No runtime network calls. Private paths and reasoning stay hidden by default.

## Install

```bash
npm install -g logsesh
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

## Privacy

- Paths are anonymized by default.
- Search snippets are redacted by default.
- Reasoning is excluded unless explicitly requested.
- Full exports warn unless `--redact` is set.

## License

MIT
