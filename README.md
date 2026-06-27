# logsesh

Local-first CLI for reading, searching, and exporting AI coding-agent session logs.

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

Run this first on any machine:

```bash
logsesh doctor
```

It checks log discovery, adapter health, and the bundled pricing table.

## Golden paths

Copy-paste flows for the three jobs people actually show up with.

### See what you've spent this week

```bash
logsesh stats --since 7d --estimate-cost
```

Shows token totals plus split cost lines: logged USD (when present in logs), estimated USD (from the pricing table), and unpriced sessions.

### Find a session where you debugged something

```bash
logsesh search 'project:myapp auth middleware'
```

`search` scans transcripts and prints snippets. Use the same query language with `list` or `stats` when you only need matching sessions, not snippets:

```bash
logsesh list --query 'project:myapp auth'
logsesh stats --since 30d --query 'project:myapp' --estimate-cost
```

### Export last month for your records

```bash
logsesh export --format markdown --since 30d --out sessions.md
```

Transcript exports are **redacted by default**. Paths are anonymized unless you pass `--no-anonymize-paths`. To export full transcript text, opt in explicitly:

```bash
logsesh export --format json --since 30d --allow-sensitive --out raw.json
```

## Query language

One query syntax works across `search`, `list`, `stats`, and `export`:

| piece | example | meaning |
| --- | --- | --- |
| text terms | `auth middleware` | match transcript text (OR by default) |
| AND | `auth AND middleware` | both terms required |
| phrase | `"rate limit"` | exact phrase |
| project | `project:myapp` | match project directory name or path segment |
| combined | `project:myapp auth` | project filter + transcript search |

`--project myapp` is shorthand for `project:myapp` in `--query`. Prefer the query form when combining project scope with text terms.

Full paths still work: `--project ~/code/myapp` or `project:~/code/myapp`.

## Commands

| command | purpose |
| --- | --- |
| `doctor` | check log access, adapters, and pricing table |
| `list` | show matching sessions |
| `search` | find text across transcripts (with snippets) |
| `stats` | summarize activity, tokens, and cost |
| `export` | write JSON, JSONL, Markdown, or CSV |

Run `logsesh <command> --help` for all options.

## Scripting / exit codes

| code | meaning |
| --- | --- |
| **0** | success |
| **1** | no matching results (`search` always; `list --json` / `stats --json` when zero sessions match) |
| **2** | usage or validation error (bad flags, invalid dates, uncaught failures) |

Human table output for `list` and `stats` returns **0** even when empty. Use `--json` when scripts need to branch on zero results without parsing stdout.

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

## Sources

| tool | default location |
| --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` |
| Gemini CLI | experimental |

Override discovery with `--roots tool:path` (repeatable).

## Privacy defaults

- Paths are anonymized in human output for `list`, `search`, and `stats`.
- Search snippets are redacted by default.
- Reasoning is excluded unless `--include-reasoning` or `--search-reasoning` is set.
- Export redaction is on by default; use `--allow-sensitive` to opt out.
- Logged `costUsd` is never overwritten; `--estimate-cost` adds pricing-table estimates with confidence metadata.

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
