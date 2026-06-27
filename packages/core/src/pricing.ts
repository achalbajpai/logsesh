import pricingData from "../pricing/models.json" with { type: "json" };
import { z } from "zod";
import type { Estimate, PricingProvenance, Session } from "./types.js";

const PriceRowSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
});

const PricingModelRowSchema = PriceRowSchema.extend({
  provider: z.string().min(1),
  model: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1),
  status: z.enum(["current", "historical", "retired"]),
  availability: z.enum(["available", "restricted", "retired"]),
  sourceUrl: z.string().url(),
  verifiedAt: z.string().min(1),
  effectiveFrom: z.string().min(1),
  note: z.string().min(1).optional(),
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
type PricingModelRow = z.infer<typeof PricingModelRowSchema>;
type PricingConfidence = Estimate["pricingConfidence"];

const DATA = PricingDataSchema.parse(pricingData);

export const PRICING_VERSION = DATA.version;
export const PRICING_AS_OF = DATA.asOf;
export const PRICING_SOURCE_URL = DATA.sourceUrl;
export const PRICING_MODEL_COUNT = DATA.models.length;

function normalizeModel(model: string): string {
  return model.toLowerCase().replace(/[._]/g, "-");
}

function modelMatchesAlias(model: string, alias: string): boolean {
  const normalized = normalizeModel(model);
  const aliasNorm = normalizeModel(alias);
  return normalized === aliasNorm || normalized.startsWith(`${aliasNorm}-`);
}

function modelExactlyMatchesAlias(model: string, alias: string): boolean {
  return normalizeModel(model) === normalizeModel(alias);
}

function rowProvenance(row: PricingModelRow): PricingProvenance {
  return {
    provider: row.provider,
    model: row.model,
    sourceUrl: row.sourceUrl,
    verifiedAt: row.verifiedAt,
    effectiveFrom: row.effectiveFrom,
    status: row.status,
    availability: row.availability,
  };
}

function priceForModel(model: string | undefined): {
  price: PriceRow;
  matched: boolean;
  matchedAlias?: string;
  row?: PricingModelRow;
} {
  if (!model) return { price: DATA.default, matched: false };
  for (const row of DATA.models) {
    for (const alias of row.aliases) {
      if (modelExactlyMatchesAlias(model, alias)) {
        return { price: row, matched: true, matchedAlias: alias, row };
      }
    }
  }
  for (const row of DATA.models) {
    for (const alias of row.aliases) {
      if (modelMatchesAlias(model, alias)) {
        return { price: row, matched: true, matchedAlias: alias, row };
      }
    }
  }
  return { price: DATA.default, matched: false };
}

export function estimateSessionCost(session: Session): Estimate {
  const { price, matched, matchedAlias, row } = priceForModel(session.model);
  const status = row?.status;
  const availability = row?.availability;
  const note = row?.note;
  const usage = session.usage ?? {};
  const warnings: string[] = [];
  let pricingConfidence: PricingConfidence = "exact";

  if (!session.model) {
    pricingConfidence = "unknown";
    warnings.push("missing model; cost estimate unavailable because no model was parsed");
  } else if (!matched) {
    pricingConfidence = "fallback";
    warnings.push(
      `stale or unknown pricing for model ${session.model}; cost estimate unavailable from pricing table ${PRICING_AS_OF} (${PRICING_SOURCE_URL})`,
    );
  } else if (status === "retired") {
    pricingConfidence = "historical";
    warnings.push(
      `retired model ${session.model}; requests to retired models may fail. ${note ?? "Kept only for estimating old local logs."}`,
    );
  } else if (status === "historical") {
    pricingConfidence = "historical";
    warnings.push(
      `historical pricing for model ${session.model}; verify current provider pricing before billing or accounting use`,
    );
  } else if (
    matched &&
    matchedAlias &&
    session.model &&
    normalizeModel(session.model) !== normalizeModel(matchedAlias)
  ) {
    warnings.push(`matched pricing alias ${matchedAlias} for model ${session.model}`);
  }
  if (availability === "restricted" && session.model) {
    warnings.push(
      `restricted availability for model ${session.model}; ${note ?? "verify access before use"}`,
    );
  } else if (availability === "retired" && session.model && status !== "retired") {
    warnings.push(`retired model ${session.model}; ${note ?? "kept for historical log estimates"}`);
  }

  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;

  const costUsd =
    pricingConfidence === "unknown" || pricingConfidence === "fallback"
      ? null
      : (input / 1_000_000) * price.input +
        (output / 1_000_000) * price.output +
        (cacheRead / 1_000_000) * (price.cacheRead ?? price.input * 0.1) +
        (cacheWrite / 1_000_000) * (price.cacheWrite ?? price.input);

  return {
    costUsd: costUsd !== null && Number.isFinite(costUsd) ? costUsd : null,
    pricingVersion: PRICING_VERSION,
    pricingAsOf: PRICING_AS_OF,
    pricingSourceUrl: row?.sourceUrl ?? PRICING_SOURCE_URL,
    model: session.model,
    pricingConfidence,
    pricingProvenance: row ? rowProvenance(row) : undefined,
    includesCacheTokens: true,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function applyEstimate(session: Session): Session {
  return { ...session, estimate: estimateSessionCost(session) };
}
