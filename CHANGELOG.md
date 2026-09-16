# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-09-16

### Added

- Byte-capped JSONL reader with per-record limits, head/tail degraded scans, and `SourceFidelity` on every session.
- Optional `lineage`, `branch`, and `source.lifecycle` on the public session schema. Claude subagent files and Codex child threads keep explicit parent/child metadata only.
- Antigravity CLI / ACP adapter. Discovers `agy` JSONL transcripts and conversation databases under `~/.gemini`. Other ACP stores work with `--roots antigravity:<path>`. Gemini CLI `~/.gemini/tmp` remains as a legacy adapter.
- Query fields `tool:`, `model:`, `agent:`, `parent:`, `branch:`, and `toolcall:`.
- `logsesh index build|status|clear|path` — opt-in local SQLite cache with FTS when Node provides it. Search/list/stats use it when present; `--roots` and `--no-index` still scan files.
- `doctor` samples real files and reports format health plus pricing staleness.
- `--large-files auto|degraded|full`. The default path no longer skips every file over 200 MiB unless `--max-file-bytes` is set.

### Fixed

- Index reads treat missing new log files and schema rebuilds as stale, then `list` / `search` / `stats` scan live logs instead of returning a partial cache.
- Degraded JSONL head scans drop the leftover bytes at the head-range cut instead of emitting a truncated record.
- Index refresh treats Commander's empty `--project` list as unfiltered, so vanished log files are dropped from the cache.
- Refreshing a changed session deletes its FTS rows before rewrite, so `transcript_fts` does not keep a growing copy of every transcript.
- Indexed `list` / `search` / `stats` return stored parse warnings instead of an empty array. Existing caches rebuild on open (schema 2) and live-scan until `logsesh index build`.

### Changed

- Pin TypeScript 7.0.2 and tsdown 0.22.14. Package declarations come from `tsc --emitDeclarationOnly`; the TypeScript 5.7 emit alias is gone. tsdown stays on 0.22 so local Node 25 still runs (0.23 dropped it).
- Add `pnpm check:release` for version alignment, changelog headings, schema drift, pricing, and packed tarball contents. It is part of `verify`. The current package version needs its own `## [x.y.z]` heading, dated or `Unreleased`; an older Unreleased section is not enough. A version tag also requires a dated changelog heading and matching package versions.
- Split CI into verify (ubuntu / Node 22, including check:release), a PR runtime matrix (ubuntu/macOS/Windows on Node 22, plus ubuntu on Node 24 and 26), and a single coverage job. Tag releases re-check `RELEASE_TAG` and smoke-test the published CLI without failing the job.
- Claude and Codex path parsing uses Node path APIs so Windows slugs and session ids match POSIX.
- Adapter versions are 0.2.0. Antigravity is the current Google CLI; leftover Gemini CLI JSONL is still parsed.
- Refresh bundled pricing to 2026-09-v7.

### Migration

JSON field meanings are unchanged. New session, search, stats, and doctor fields are optional. `maxFileBytes` still skips a file when you pass it; omitting it uses the new large-file policy. The index is never created unless you run `logsesh index build`.

## [0.2.3] - Unreleased

### Added

- Shared empty-state copy for `list`, `stats`, and `search` (search no longer stays silent on zero matches).
- Unified rich command chrome (`section` title + rule) across `doctor`, `list`, `stats`, and `search`.
- `doctor` overall status (`healthy` / `partial` / `broken`) and a single next-action line.
- stderr scan progress (`scanning… N files`) on TTY cold scans for `list`, `stats`, and `search` (suppressed for `--json`, `--plain`, and pipes).

### Changed

- Stats summary strip uses dim labels and bright values.
- Token-split colors go through the shared theme.
- Truncation uses Unicode `…` in rich mode and ASCII `...` in plain mode.
- `doctor` leads with adapter health; pricing is secondary. Warnings print once in the doctor report (not also on stderr).

## [0.2.2] - 2026-06-28

### Added

- Rich terminal dashboards for `list`, `stats`, `search`, and `doctor` when stdout is a TTY.
- Global human output flags for `list`, `stats`, `search`, and `doctor`:
  - `--plain` — stable ASCII text without charts or ANSI color
  - `--color` / `--no-color` — force or disable ANSI color in rich mode
- Environment overrides: `LOGSESH_PLAIN=1`, `NO_COLOR`, `FORCE_COLOR`.
- `stats` rich dashboard sections: summary strip, reported token split, daily burn chart + sparkline, ranked tools/projects, and cost caveats. Sections render only when backed by real data.
- Additive `stats` JSON fields: `dailyBurn` and `tokenBreakdown` (with `observed` flags and `observedSessionCount`).
- Case-insensitive search highlighting in rich mode (plain mode unchanged).

### Changed

- Default human output for `list`, `stats`, `search`, and `doctor` is now width-aware and uses Unicode charts/bars when stdout is a TTY.
- `stats --plain` and piped human output keep the previous flat-line / simple-table style.
- Token humanization now supports billions (`7.01B`) and uses two decimal places for millions (`155.69M`).

### Migration

**v0.2.x changes default human output.** If you parse CLI output in a script, use one of:

- `logsesh <command> --json` for stable machine-readable envelopes, or
- `logsesh <command> --plain` for stable human text close to pre-0.2.0 output.

Do not parse rich dashboard text — layout may change in minor releases. JSON field semantics and exit codes are unchanged; `stats` JSON fields are additive only.

`export` and hidden `debug` are unaffected by the new render flags.

## [0.1.4] - Previous releases

See git history for earlier changes.
