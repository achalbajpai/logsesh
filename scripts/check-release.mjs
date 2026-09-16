#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  changelogHasUnreleasedHeading,
  changelogHasVersionHeading,
  escapeRe,
} from "./changelog-heading.mjs";

const ROOT = join(import.meta.dirname, "..");
const CORE_DIR = join(ROOT, "packages/core");
const CLI_DIR = join(ROOT, "packages/cli");
const windows = process.platform === "win32";
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseReleaseTag(argv, envTag) {
  let tag = envTag && envTag.trim() !== "" ? envTag.trim() : null;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--release") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        fail("--release requires a tag like v0.3.0");
        return tag;
      }
      tag = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--release=")) {
      const value = arg.slice("--release=".length);
      if (value === "") {
        fail("--release requires a tag like v0.3.0");
        return tag;
      }
      tag = value;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  return tag;
}

function packedPaths(pkgDir) {
  const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: pkgDir,
    encoding: "utf8",
    shell: windows,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const jsonStart = stdout.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(`npm pack --json produced no JSON in ${pkgDir}`);
  }
  const parsed = JSON.parse(stdout.slice(jsonStart));
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return (entry.files ?? []).map((file) => String(file.path).replaceAll("\\", "/"));
}

function hasFile(paths, file) {
  return paths.includes(file);
}

function hasPrefix(paths, prefix) {
  return paths.some((path) => path === prefix || path.startsWith(`${prefix}/`));
}

function isSourceOrTest(path) {
  return (
    path === "src" ||
    path.startsWith("src/") ||
    path === "test" ||
    path.startsWith("test/") ||
    path.includes("/test/") ||
    path.endsWith(".test.ts") ||
    path.endsWith(".test.js")
  );
}

const releaseTag = parseReleaseTag(process.argv, process.env.RELEASE_TAG);
const corePkg = readJson(join(CORE_DIR, "package.json"));
const cliPkg = readJson(join(CLI_DIR, "package.json"));
const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");

if (corePkg.version !== cliPkg.version) {
  fail(`package versions differ: @logsesh/core ${corePkg.version} vs logsesh ${cliPkg.version}`);
}

const version = corePkg.version;
const hasVersionHeading = changelogHasVersionHeading(changelog, version);
const hasUnreleased = changelogHasUnreleasedHeading(changelog, version);
if (!hasVersionHeading && !hasUnreleased) {
  fail(`CHANGELOG.md has no ## [${version}] heading (dated or Unreleased)`);
}

if (releaseTag) {
  const expected = releaseTag.replace(/^v/, "");
  if (version !== expected) {
    fail(`package version ${version} does not match release tag ${releaseTag}`);
  }
  const dated = new RegExp(`^## \\[${escapeRe(expected)}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`, "m");
  const unreleasedThis = new RegExp(`^## \\[${escapeRe(expected)}\\].*Unreleased`, "m");
  if (unreleasedThis.test(changelog) || !dated.test(changelog)) {
    fail(`CHANGELOG.md must have a dated heading for ${expected} (not Unreleased)`);
  }
}

execFileSync(process.execPath, [join(ROOT, "scripts/check-schema-drift.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
});
execFileSync(process.execPath, [join(ROOT, "scripts/check-pricing.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
});

if (
  !existsSync(join(CORE_DIR, "dist/index.js")) ||
  !existsSync(join(CORE_DIR, "dist/index.d.ts"))
) {
  fail("packages/core/dist/index.js and index.d.ts are missing; run pnpm build first");
}
if (!existsSync(join(CLI_DIR, "dist/index.js")) || !existsSync(join(CLI_DIR, "dist/index.d.ts"))) {
  fail("packages/cli/dist/index.js and index.d.ts are missing; run pnpm build first");
}

const coreFiles = packedPaths(CORE_DIR);
if (!hasFile(coreFiles, "dist/index.js")) fail("core pack is missing dist/index.js");
if (!hasFile(coreFiles, "dist/index.d.ts")) fail("core pack is missing dist/index.d.ts");
if (!hasPrefix(coreFiles, "dist")) fail("core pack is missing dist/**");
if (!coreFiles.some((path) => path.startsWith("dist/") && path.endsWith(".d.ts"))) {
  fail("core pack is missing .d.ts files");
}
if (!hasPrefix(coreFiles, "schemas")) fail("core pack is missing schemas");
if (!hasPrefix(coreFiles, "pricing")) fail("core pack is missing pricing");
for (const path of coreFiles) {
  if (path.includes("test/fixtures")) fail(`core pack includes test fixtures: ${path}`);
  if (isSourceOrTest(path)) fail(`core pack includes source or test file: ${path}`);
}

const cliFiles = packedPaths(CLI_DIR);
if (!hasFile(cliFiles, "dist/index.js")) fail("CLI pack is missing dist/index.js");
if (!hasFile(cliFiles, "dist/index.d.ts")) fail("CLI pack is missing dist/index.d.ts");
if (!hasPrefix(cliFiles, "dist")) fail("CLI pack is missing dist/**");
if (!cliFiles.some((path) => path.startsWith("dist/") && path.endsWith(".d.ts"))) {
  fail("CLI pack is missing .d.ts files");
}
for (const path of cliFiles) {
  if (isSourceOrTest(path)) fail(`CLI pack includes source or test file: ${path}`);
}

const cliIndex = existsSync(join(CLI_DIR, "dist/index.js"))
  ? readFileSync(join(CLI_DIR, "dist/index.js"), "utf8")
  : "";
if (!cliIndex.startsWith("#!/usr/bin/env node")) {
  fail("CLI dist/index.js is missing the node shebang");
}

if (failures.length > 0) {
  for (const message of failures) console.error(`check:release: ${message}`);
  process.exit(1);
}

console.log(`check:release: ok (${version}${releaseTag ? `, release ${releaseTag}` : ""})`);
