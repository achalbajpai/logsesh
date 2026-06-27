import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  debugEnvelopeSchema,
  doctorEnvelopeSchema,
  jsonExportEnvelopeSchema,
  jsonlRecordSchema,
  listEnvelopeSchema,
  publicSessionSchema,
  searchEnvelopeSchema,
  sessionSchema,
  statsEnvelopeSchema,
} from "../packages/core/src/schemas.js";

const outDir = join(import.meta.dirname, "../packages/core/schemas");
mkdirSync(outDir, { recursive: true });

const schemas: Record<string, z.ZodType> = {
  session: sessionSchema,
  "public-session": publicSessionSchema,
  "list-envelope": listEnvelopeSchema,
  "search-envelope": searchEnvelopeSchema,
  "stats-envelope": statsEnvelopeSchema,
  "debug-envelope": debugEnvelopeSchema,
  "doctor-envelope": doctorEnvelopeSchema,
  "json-export-envelope": jsonExportEnvelopeSchema,
  "jsonl-record": jsonlRecordSchema,
};

for (const [name, schema] of Object.entries(schemas)) {
  const jsonSchema = z.toJSONSchema(schema);
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(jsonSchema, null, 2) + "\n");
}

console.log(`Wrote ${Object.keys(schemas).length} schemas to ${outDir}`);
