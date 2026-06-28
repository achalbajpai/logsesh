# logsesh

Read, search, summarize, and export local AI coding-agent session logs.

No telemetry. No runtime network calls. Paths are anonymized, known secret patterns are redacted, and reasoning is excluded by default.

## Install

```bash
npm install -g logsesh
logsesh doctor
```

Requires Node.js `>=22`.

For library usage:

```bash
npm install @logsesh/core
```

## Quick Start

```bash
logsesh list
logsesh search 'project:myapp auth middleware'
logsesh stats --since 7d --estimate-cost
logsesh export --format markdown --since 30d --out sessions.md
```

`doctor` is the best first command on a new machine. It checks log discovery, adapter health, export defaults, and bundled pricing data.

## Output Modes

Human-facing commands (`list`, `stats`, `search`, `doctor`) support three output modes:

| mode | trigger | output |
| --- | --- | --- |
| **rich** (default) | stdout is a TTY | width-aware tables and charts, Unicode bars, optional ANSI color |
| **plain** | `--plain`, `LOGSESH_PLAIN=1`, or piped stdout | stable ASCII text — no charts, no ANSI |
| **JSON** | `--json` | stable envelopes (`logsesh.list.v1`, etc.) |

`export` and hidden `debug` are not affected by render flags. `--plain`, `--color`, and `--no-color` are accepted but ignored under `--json`.

Compare `stats` across modes:

```bash
logsesh stats --since 7d                   # rich dashboard (TTY)
logsesh stats --since 7d --plain           # flat summary lines
logsesh stats --since 7d --json            # StatsEnvelope JSON
logsesh stats --since 7d | cat             # plain when piped
```

Color and Unicode are independent in rich mode:

| flag / env | effect |
| --- | --- |
| `--color` | force ANSI color |
| `--no-color` | disable ANSI color |
| `NO_COLOR` | disable ANSI color (Unicode charts remain) |
| `FORCE_COLOR` | force ANSI color when rich mode is active |
| `LOGSESH_PLAIN=1` | same as `--plain` |

Passing both `--color` and `--no-color` is a usage error (exit `2`). `FORCE_COLOR` does not override plain mode on a pipe.

**Scripts:** parse `--json` or use `--plain` for stable output. Do not parse rich dashboard text. See [CHANGELOG.md](./CHANGELOG.md) for the v0.2.0 migration note.

## Commands

| command | purpose |
| --- | --- |
| `doctor` | check log access, adapters, export defaults, and pricing data |
| `list` | show matching sessions |
| `search` | find transcript text with snippets |
| `stats` | summarize activity, tokens, and cost |
| `export` | write JSON, JSONL, Markdown, or CSV |

Run `logsesh <command> --help` for all options.

Human `list` and `stats` return exit `0` when no sessions match. Use `--json` when scripts need exit `1` on empty results (`search --json` always follows match count).

## Query Language

The same query syntax works across `search`, `list`, `stats`, and `export`.

| query | meaning |
| --- | --- |
| `auth middleware` | match transcript text |
| `auth AND middleware` | require both terms |
| `"rate limit"` | exact phrase |
| `project:myapp` | match project directory name or path segment |
| `project:myapp auth` | project filter plus text search |

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

## Library

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

## Develop

```bash
pnpm install
pnpm verify
pnpm test:coverage
```

Before publishing:

```bash
pnpm --filter @logsesh/core pack --dry-run
pnpm --filter logsesh pack --dry-run
```

Publish `@logsesh/core` before `logsesh`; the CLI depends on the core package.

## License

MIT
