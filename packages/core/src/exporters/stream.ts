import type { Writable } from "node:stream";
import type { ExportSession, ExportTurn, PublicWarning } from "../types.js";
import { generatedAt } from "../schemas.js";

export interface JsonExportStreamOptions {
  granularity: "session" | "turn";
  getWarnings?: () => PublicWarning[];
  pretty?: boolean;
}

export function beginJsonExportStream(
  out: Writable,
  opts: JsonExportStreamOptions,
): { writeRecord: (record: ExportSession | ExportTurn) => void; end: () => void } {
  const pretty = opts.pretty ?? false;
  const spacer = pretty ? 2 : undefined;
  const header = {
    format: "logsesh.export.v1" as const,
    generatedAt: generatedAt(),
    granularity: opts.granularity,
  };
  out.write(JSON.stringify(header, null, spacer).replace(/\}\s*$/, "") + ',"records":[');
  let first = true;

  return {
    writeRecord(record) {
      if (!first) out.write(",");
      out.write(JSON.stringify(record, null, spacer));
      first = false;
    },
    end() {
      const warnings = opts.getWarnings?.() ?? [];
      const footer = `],"warnings":${JSON.stringify(warnings, null, spacer)}}\n`;
      out.write(footer);
    },
  };
}

export async function writeJsonExportStream(
  out: Writable,
  records: AsyncIterable<ExportSession | ExportTurn>,
  opts: JsonExportStreamOptions,
): Promise<void> {
  const stream = beginJsonExportStream(out, opts);
  for await (const record of records) {
    stream.writeRecord(record);
  }
  stream.end();
}
