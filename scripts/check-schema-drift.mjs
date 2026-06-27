#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dirname, "..");
const SCHEMA_DIR = join(ROOT, "packages/core/schemas");
const GEN = join(ROOT, "scripts/gen-schema.ts");
const tmp = mkdtempSync(join(tmpdir(), "logsesh-schema-"));
const before = join(tmp, "before");

try {
  cpSync(SCHEMA_DIR, before, { recursive: true });
  execFileSync(process.execPath, ["--import", "tsx/esm", GEN], { cwd: ROOT, stdio: "pipe" });

  const beforeFiles = new Set(readdirSync(before).filter((f) => f.endsWith(".json")));
  const afterFiles = new Set(readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".json")));
  const all = new Set([...beforeFiles, ...afterFiles]);
  const changed = [];

  for (const file of all) {
    const beforePath = join(before, file);
    const afterPath = join(SCHEMA_DIR, file);
    if (!beforeFiles.has(file)) {
      changed.push(`${file} (added)`);
      continue;
    }
    if (!afterFiles.has(file)) {
      changed.push(`${file} (removed)`);
      continue;
    }
    if (readFileSync(beforePath, "utf8") !== readFileSync(afterPath, "utf8")) {
      changed.push(file);
    }
  }

  if (changed.length > 0) {
    console.error("schema drift detected; run pnpm gen:schema and commit:");
    for (const file of changed) console.error(`  - ${file}`);
    process.exit(1);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
