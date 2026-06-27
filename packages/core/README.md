# @logsesh/core

Parser, normalization, search, export-safety, and cost-estimation library behind `logsesh`.

Use it when you want to build your own local workflows on top of Claude Code, Codex, or Gemini CLI session logs.

## Install

```bash
npm install @logsesh/core
```

Requires Node.js `>=22`.

## Use

```ts
import { runPipeline, sanitizeForExport } from "@logsesh/core";

for await (const { session, warnings } of runPipeline({ toolFilter: ["codex"] })) {
  for (const warning of warnings) console.warn(warning.message);
  if (!session) continue;

  const safeSession = sanitizeForExport(session);
  console.log(safeSession);
}
```

## Main Exports

| export | purpose |
| --- | --- |
| `runPipeline` | discover and parse sessions |
| `parseFile` | parse one known log file |
| `sanitizeForExport` | remove raw paths and reasoning by default |
| `searchSession` | search a normalized session |
| `StatsAggregator` | aggregate session stats |
| `estimateSessionCost` | add labeled pricing estimates with confidence |
| `runDoctor` | inspect adapter, discovery, export defaults, and pricing data |

## Published Data

```ts
import sessionSchema from "@logsesh/core/schemas/session.json" with { type: "json" };
import models from "@logsesh/core/pricing/models.json" with { type: "json" };
```

Schemas are available under `@logsesh/core/schemas/*`.
Pricing data is available under `@logsesh/core/pricing/*`.

Cost estimates are exact only when a parsed session includes a known priced model. Historical and uncertain model rows are preserved with confidence metadata so callers can explain where estimates came from.

## Safety Defaults

`sanitizeForExport` removes reasoning blocks and raw source paths unless you explicitly request them.

```ts
const safe = sanitizeForExport(session);
const withReasoning = sanitizeForExport(session, { includeReasoning: true });
const withRawPaths = sanitizeForExport(session, { rawPaths: true });
```

## Compatibility

Normalized sessions use the `logsesh.session.v1` schema version.

## License

MIT
