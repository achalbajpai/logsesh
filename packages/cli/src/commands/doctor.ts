import { doctorEnvelopeSchema, parseRootsOverride, runDoctor } from "@logsesh/core";
import { printWarningsToStderr } from "../util/format.js";
import { renderDoctor } from "../ui/doctor.js";
import { resolveRenderMode, validateRenderOptions } from "../ui/mode.js";

export interface DoctorOptions {
  json?: boolean;
  plain?: boolean;
  color?: boolean;
  roots?: string[];
}

export async function runDoctorCommand(opts: DoctorOptions): Promise<number> {
  if (!opts.json) {
    const renderError = validateRenderOptions(opts);
    if (renderError) {
      console.error(renderError);
      return 2;
    }
  }

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

  const renderMode = resolveRenderMode(opts);
  for (const line of renderDoctor(report, renderMode)) {
    console.log(line);
  }

  return 0;
}
