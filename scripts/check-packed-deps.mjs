#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PUBLISHABLE_PACKAGES = ["@logsesh/core", "logsesh"];
const FORBIDDEN_PROTOCOLS = ["workspace:", "catalog:"];

const tmp = mkdtempSync(join(tmpdir(), "logsesh-pack-"));

function packPackage(packageName) {
  const output = execFileSync(
    "pnpm",
    ["--filter", packageName, "pack", "--pack-destination", tmp],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  const tarball = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(tmp) && line.endsWith(".tgz"));

  if (!tarball) {
    throw new Error(`could not find packed tarball path for ${packageName}`);
  }

  return tarball;
}

function readPackedPackageJson(tarball) {
  const raw = execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

function checkDependencyBlock(packageName, blockName, dependencies = {}) {
  const failures = [];
  for (const [dependencyName, range] of Object.entries(dependencies)) {
    if (typeof range !== "string") continue;
    if (FORBIDDEN_PROTOCOLS.some((protocol) => range.startsWith(protocol))) {
      failures.push(`${packageName} ${blockName}.${dependencyName} uses ${range}`);
    }
  }
  return failures;
}

try {
  const failures = [];

  for (const packageName of PUBLISHABLE_PACKAGES) {
    const packedPackage = readPackedPackageJson(packPackage(packageName));
    failures.push(...checkDependencyBlock(packageName, "dependencies", packedPackage.dependencies));
    failures.push(
      ...checkDependencyBlock(
        packageName,
        "optionalDependencies",
        packedPackage.optionalDependencies,
      ),
    );
    failures.push(
      ...checkDependencyBlock(packageName, "peerDependencies", packedPackage.peerDependencies),
    );
  }

  if (failures.length > 0) {
    console.error("packed package dependency check failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log("packed package dependencies OK");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
