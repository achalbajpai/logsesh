# @logsesh/core

parse and normalize ai coding agent session logs.

## install

```bash
npm install @logsesh/core
```

## usage

```ts
import { runPipeline, sanitizeForExport } from "@logsesh/core";

for await (const { session } of runPipeline({ toolFilter: ["claude-code"] })) {
  if (!session) continue;
  const exported = sanitizeForExport(session);
}
```

```ts
import sessionSchema from "@logsesh/core/schemas/session.json" with { type: "json" };
import models from "@logsesh/core/pricing/models.json" with { type: "json" };
```

requires node `>=22`.

## license

MIT
