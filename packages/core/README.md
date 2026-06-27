# @logsesh/core

Parser and normalization library behind `logsesh`.

Use it to discover local agent logs, normalize sessions, sanitize exports, validate schemas, and estimate costs.

## Install

Workspace only for now (not on npm yet). From the monorepo root:

```bash
pnpm install
pnpm build
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

## Modules

| export | purpose |
| --- | --- |
| `runPipeline` | discover and parse sessions |
| `sanitizeForExport` | remove raw paths and reasoning by default |
| `searchSession` | search a normalized session |
| `StatsAggregator` | aggregate session stats |
| `estimateSessionCost` | add labeled pricing estimates with confidence |

## Published Data

```ts
import sessionSchema from "@logsesh/core/schemas/session.json" with { type: "json" };
import models from "@logsesh/core/pricing/models.json" with { type: "json" };
```

Schemas are available under `@logsesh/core/schemas/*`.
Pricing data is available under `@logsesh/core/pricing/*`. Estimates are exact only when the parsed session includes a known current model; officially priced older rows are preserved as historical estimates.

## License

MIT
