#!/usr/bin/env node
import {
  PRICING_AS_OF,
  PRICING_MODEL_COUNT,
  PRICING_VERSION,
} from "../packages/core/src/pricing.ts";

console.log(
  `pricing OK: version=${PRICING_VERSION} asOf=${PRICING_AS_OF} models=${PRICING_MODEL_COUNT}`,
);
