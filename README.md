# logsesh

Local-first CLI for AI coding-agent session logs.

Search past work, inspect usage, estimate cost, and export sessions from Claude Code, Codex, and Gemini CLI logs. No telemetry. No runtime network calls.

```bash
npm install -g logsesh
logsesh doctor
```

Requires Node.js `>=22`.

<p align="center">
  <img width="1095" alt="logsesh overview" src="https://github.com/user-attachments/assets/e002baa9-ba08-4136-9d82-beac5d2f0584" />
</p>

<p align="center">
  <img width="49%" alt="logsesh doctor output" src="https://github.com/user-attachments/assets/a4813d8e-4dbc-4780-beb5-e9362723d424" />
  <img width="49%" alt="logsesh stats output" src="https://github.com/user-attachments/assets/4504af7f-9b9b-4817-b315-accf7156c01f" />
</p>

_Screenshots use mock data._

## Use

```bash
logsesh list
logsesh search 'project:myapp auth middleware'
logsesh stats --since 7d --estimate-cost
logsesh export --format markdown --since 30d --out sessions.md
```

`doctor` is the best first command on a new machine. It checks log discovery, adapter health, export defaults, and bundled pricing data.

## Commands

| command | purpose |
| --- | --- |
| `doctor` | check log access, adapters, export defaults, and pricing data |
| `list` | show matching sessions |
| `search` | find transcript text with snippets |
| `stats` | summarize activity, tokens, and cost |
| `export` | write JSON, JSONL, Markdown, or CSV |

Run `logsesh <command> --help` for all options.

## Output

Human output is rich by default when stdout is a TTY. Use `--json` for scripts and `--plain` for stable text.

```bash
logsesh stats --since 7d         # rich dashboard
logsesh stats --since 7d --json  # machine-readable envelope
logsesh stats --since 7d --plain # stable text
```

## Query

The same query syntax works across `search`, `list`, `stats`, and `export`.

| query | meaning |
| --- | --- |
| `auth middleware` | match transcript text |
| `auth AND middleware` | require both terms |
| `"rate limit"` | exact phrase |
| `project:myapp` | match project directory name or path segment |
| `project:myapp auth` | project filter plus text search |

`--project myapp` is shorthand for `project:myapp`.

## Safety

Transcript exports redact known sensitive patterns by default. Paths are anonymized unless you opt out.

| flag | effect |
| --- | --- |
| `--allow-sensitive` / `--no-redact` | export full transcript text |
| `--redact-pattern <regex>` | add a custom redaction pattern |
| `--include-reasoning` | include reasoning blocks |
| `--no-anonymize-paths` | keep raw filesystem paths |
| `--unsafe-raw` | disable Markdown injection neutralization |

Summary-only CSV keeps path anonymization on by default. Pass `--redact` to apply pattern redaction to summary rows too.

## Supported Logs

| tool | default location |
| --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` |
| Gemini CLI | experimental adapter |

Override discovery with `--roots tool:path` and repeat it for multiple roots.

## Library

```bash
npm install @logsesh/core
```

```ts
import { runPipeline, sanitizeForExport } from "@logsesh/core";

for await (const { session, warnings } of runPipeline({ toolFilter: ["codex"] })) {
  for (const warning of warnings) console.warn(warning.message);
  if (!session) continue;

  console.log(sanitizeForExport(session));
}
```

Schemas are published under `@logsesh/core/schemas/*`.
Pricing data is published under `@logsesh/core/pricing/*`.

## License

MIT
