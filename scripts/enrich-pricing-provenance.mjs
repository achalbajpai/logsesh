import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const path = join(import.meta.dirname, "../packages/core/pricing/models.json");
const checkOnly = process.argv.includes("--check");

const OPENAI_URL = "https://platform.openai.com/docs/pricing";
const ANTHROPIC_URL = "https://docs.anthropic.com/en/docs/about-claude/pricing";
const ANTHROPIC_RETIRED_URL = "https://platform.claude.com/docs/en/about-claude/model-deprecations";

function inferProvider(aliases) {
  const primary = aliases[0].toLowerCase();
  if (/^(claude|sonnet|opus|haiku|fable|mythos)/.test(primary)) return "anthropic";
  return "openai";
}

function aliasDate(alias) {
  const match = alias.match(/(20\d{6})/);
  if (!match) return undefined;
  const raw = match[1];
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function effectiveFromForRow(row, asOf) {
  for (const alias of row.aliases) {
    const date = aliasDate(alias);
    if (date) return date;
  }
  if (row.status === "retired" || row.status === "historical") return asOf;
  return "2026-04-24";
}

function sourceUrlFor(provider, status) {
  if (provider === "anthropic" && status === "retired") return ANTHROPIC_RETIRED_URL;
  return provider === "anthropic" ? ANTHROPIC_URL : OPENAI_URL;
}

function enrichData(data) {
  return {
    ...data,
    models: data.models.map((row) => {
      const provider = row.provider ?? inferProvider(row.aliases);
      const status = row.status ?? "current";
      const availability = row.availability ?? (status === "retired" ? "retired" : "available");
      const { aliases, input, output, cacheRead, cacheWrite, note } = row;

      return {
        provider,
        model: row.model ?? aliases[0],
        aliases,
        status,
        availability,
        input,
        output,
        ...(cacheRead !== undefined ? { cacheRead } : {}),
        ...(cacheWrite !== undefined ? { cacheWrite } : {}),
        ...(note ? { note } : {}),
        sourceUrl: row.sourceUrl ?? sourceUrlFor(provider, status),
        verifiedAt: row.verifiedAt ?? data.asOf,
        effectiveFrom: row.effectiveFrom ?? effectiveFromForRow(row, data.asOf),
      };
    }),
  };
}

const committed = readFileSync(path, "utf8");
const data = JSON.parse(committed);
const enriched = enrichData(data);
const enrichedText = JSON.stringify(enriched, null, 2) + "\n";

if (checkOnly) {
  if (committed !== enrichedText) {
    console.error(
      "pricing enrichment drift detected; run pnpm enrich:pricing and commit packages/core/pricing/models.json",
    );
    process.exit(1);
  }
  console.log(`pricing enrichment OK (${enriched.models.length} models)`);
} else {
  writeFileSync(path, enrichedText);
  console.log(`Enriched ${enriched.models.length} pricing rows in ${path}`);
}
