import pricingData from "../pricing/models.json" with { type: "json" };
import { z } from "zod";
import type { Estimate, Session } from "./types.js";

const PriceRowSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
});

const PricingModelRowSchema = PriceRowSchema.extend({
  aliases: z.array(z.string().min(1)).min(1),
});

const PricingDataSchema = z.object({
  version: z.string().min(1),
  asOf: z.string().min(1),
  sourceUrl: z.string().url(),
  sources: z.array(
    z.object({
      provider: z.string().min(1),
      url: z.string().url(),
      asOf: z.string().min(1),
    }),
  ),
  default: PriceRowSchema,
  models: z.array(PricingModelRowSchema).min(1),
});

type PriceRow = z.infer<typeof PriceRowSchema>;

const DATA = PricingDataSchema.parse(pricingData);

export const PRICING_VERSION = DATA.version;
export const PRICING_AS_OF = DATA.asOf;
export const PRICING_SOURCE_URL = DATA.sourceUrl;

function normalizeModel(model: string): string {
  return model.toLowerCase().replace(/[._]/g, "-");
}

function modelMatchesAlias(model: string, alias: string): boolean {
  const normalized = normalizeModel(model);
  const aliasNorm = normalizeModel(alias);
  return normalized === aliasNorm || normalized.startsWith(`${aliasNorm}-`);
}

function priceForModel(model: string | undefined): {
  price: PriceRow;
  matched: boolean;
  matchedAlias?: string;
} {
  if (!model) return { price: DATA.default, matched: false };
  for (const row of DATA.models) {
    for (const alias of row.aliases) {
      if (modelMatchesAlias(model, alias)) {
        return { price: row, matched: true, matchedAlias: alias };
      }
    }
  }
  return { price: DATA.default, matched: false };
}

export function estimateSessionCost(session: Session): Estimate {
  const { price, matched, matchedAlias } = priceForModel(session.model);
  const usage = session.usage ?? {};
  const warnings: string[] = [];

  if (!matched && session.model) {
    warnings.push(
      `stale or unknown pricing for model ${session.model}; using default table from ${PRICING_AS_OF} (${PRICING_SOURCE_URL})`,
    );
  } else if (
    matched &&
    matchedAlias &&
    session.model &&
    normalizeModel(session.model) !== normalizeModel(matchedAlias)
  ) {
    warnings.push(`matched pricing alias ${matchedAlias} for model ${session.model}`);
  }

  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;

  const costUsd =
    (input / 1_000_000) * price.input +
    (output / 1_000_000) * price.output +
    (cacheRead / 1_000_000) * (price.cacheRead ?? price.input * 0.1) +
    (cacheWrite / 1_000_000) * (price.cacheWrite ?? price.input);

  return {
    costUsd: Number.isFinite(costUsd) ? costUsd : null,
    pricingVersion: PRICING_VERSION,
    pricingAsOf: PRICING_AS_OF,
    pricingSourceUrl: PRICING_SOURCE_URL,
    model: session.model,
    includesCacheTokens: true,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function applyEstimate(session: Session): Session {
  return { ...session, estimate: estimateSessionCost(session) };
}
