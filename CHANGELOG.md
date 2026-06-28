# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - Unreleased

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

**v0.2.0 changes default human output.** If you parse CLI output in a script, use one of:

- `logsesh <command> --json` for stable machine-readable envelopes, or
- `logsesh <command> --plain` for stable human text close to pre-0.2.0 output.

Do not parse rich dashboard text — layout may change in minor releases. JSON field semantics and exit codes are unchanged; `stats` JSON fields are additive only.

`export` and hidden `debug` are unaffected by the new render flags.

## [0.1.4] - Previous releases

See git history for earlier changes.
