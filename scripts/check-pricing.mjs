#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

execFileSync(process.execPath, ["--import", "tsx/esm", join(ROOT, "scripts/validate-pricing.ts")], {
  cwd: ROOT,
  stdio: "inherit",
});

execFileSync(process.execPath, [join(ROOT, "scripts/enrich-pricing-provenance.mjs"), "--check"], {
  cwd: ROOT,
  stdio: "inherit",
});
