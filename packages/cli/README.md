# logsesh

Read, search, summarize, and export local AI coding-agent session logs.

No telemetry. No runtime network calls. Paths are anonymized, known secret patterns are redacted, and reasoning is excluded by default.

## Install

```bash
npm install -g logsesh
logsesh doctor
```

Requires Node.js `>=22`.

## Use

```bash
logsesh list
logsesh search 'project:myapp auth middleware'
logsesh stats --since 30d --estimate-cost
logsesh export --format markdown --since 30d --out sessions.md
```

`doctor` checks log discovery, adapter health, export defaults, and bundled pricing data.

## Commands

| command | purpose |
| --- | --- |
| `doctor` | check log access, adapters, export defaults, and pricing data |
| `list` | show matching sessions |
| `search` | find transcript text with snippets |
| `stats` | summarize activity, tokens, and cost |
| `export` | write JSON, JSONL, Markdown, or CSV |

Run `logsesh <command> --help` for all options.

## Query Language

```bash
logsesh search 'project:myapp "rate limit"'
logsesh list --query 'project:myapp auth'
logsesh stats --since 7d --query 'auth AND middleware' --estimate-cost
```

`--project myapp` is shorthand for `project:myapp` in `--query`. Full paths work too, such as `--project ~/code/myapp`.

## Export Safety

Transcript exports redact known sensitive patterns by default. Paths are anonymized unless you opt out.

| flag | effect |
| --- | --- |
| default | redact built-in secret patterns and anonymize paths |
| `--allow-sensitive` / `--no-redact` | export full transcript text |
| `--redact-pattern <regex>` | add a custom redaction pattern |
| `--include-reasoning` | include reasoning blocks |
| `--no-anonymize-paths` | keep raw filesystem paths |
| `--unsafe-raw` | disable Markdown injection neutralization |

Summary-only CSV keeps the same path anonymization defaults. Pass `--redact` to apply pattern redaction to summary rows too.

## Sources

| tool | default location |
| --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` |
| Gemini CLI | experimental adapter |

Override discovery with `--roots tool:path` and repeat it for multiple roots.

## Exit Codes

| code | meaning |
| --- | --- |
| `0` | success |
| `1` | no matching results for `search`, `list --json`, or `stats --json` |
| `2` | usage, validation, or uncaught runtime error |

Human table output for `list` and `stats` returns `0` even when empty. Use `--json` when scripts need to branch on zero matches.

## License

MIT
