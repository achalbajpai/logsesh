import { doctorEnvelopeSchema, parseRootsOverride, runDoctor } from "@logsesh/core";
import { printWarningsToStderr } from "../util/format.js";

export interface DoctorOptions {
  json?: boolean;
  roots?: string[];
}

export async function runDoctorCommand(opts: DoctorOptions): Promise<number> {
  let roots: ReturnType<typeof parseRootsOverride>["roots"] | undefined;
  if (opts.roots && opts.roots.length > 0) {
    const parsed = parseRootsOverride(opts.roots);
    if (parsed.errors.length > 0) {
      console.error(parsed.errors.join("\n"));
      return 2;
    }
    roots = parsed.roots;
  }

  const report = await runDoctor({ roots });

  if (opts.json) {
    doctorEnvelopeSchema.parse(report);
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  printWarningsToStderr(report.warnings ?? []);

  console.log("logsesh doctor");
  console.log("");
  console.log("Pricing table");
  console.log(`  version: ${report.pricing.version}`);
  console.log(`  as of:   ${report.pricing.asOf}`);
  console.log(`  models:  ${report.pricing.modelCount}`);
  console.log(`  source:  ${report.pricing.sourceUrl}`);
  console.log("");
  console.log("Export defaults");
  console.log(
    `  transcript redact: ${report.exportDefaults.transcriptRedactDefault ? "on (use --allow-sensitive to opt out)" : "off"}`,
  );
  console.log(
    `  summary CSV redact:  ${report.exportDefaults.summaryCsvRedactRequired ? "required" : "optional"}`,
  );
  console.log(
    `  anonymize paths:     ${report.exportDefaults.anonymizePathsDefault ? "on" : "off"}`,
  );
  console.log("");
  console.log("Adapters");

  for (const tool of report.tools) {
    const status = tool.rootAccessible
      ? tool.candidateFiles > 0
        ? `${tool.candidateFilesCapped ? ">=" : ""}${tool.candidateFiles} log file(s)`
        : "root readable, no log files found"
      : tool.permissionIssue
        ? "permission denied"
        : "not detected";
    console.log(`  ${tool.tool}`);
    console.log(`    root:         ${tool.root}`);
    console.log(`    status:       ${status}`);
    console.log(`    adapter:      ${tool.adapterVersion}`);
    console.log(
      `    capabilities: model=${tool.capabilities.model}, usage=${tool.capabilities.usage}, transcript=${tool.capabilities.transcript}, toolCalls=${tool.capabilities.toolCalls}, reasoning=${tool.capabilities.reasoning}`,
    );
    if (tool.capabilities.notes?.length) {
      for (const note of tool.capabilities.notes) {
        console.log(`    note:         ${note}`);
      }
    }
  }

  return 0;
}
