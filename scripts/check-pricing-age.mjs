#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const path = join(import.meta.dirname, "../packages/core/pricing/models.json");
const data = JSON.parse(readFileSync(path, "utf8"));
const asOf = Date.parse(data.asOf);
if (!Number.isFinite(asOf)) {
  console.error(`check-pricing-age: invalid asOf ${data.asOf}`);
  process.exit(1);
}
const ageDays = (Date.now() - asOf) / 86400000;
if (ageDays > 180) {
  console.error(
    `check-pricing-age: bundled pricing is ${ageDays.toFixed(0)} days old (asOf ${data.asOf})`,
  );
  process.exit(1);
}
console.log(`pricing age OK: asOf=${data.asOf} ageDays=${ageDays.toFixed(0)}`);
