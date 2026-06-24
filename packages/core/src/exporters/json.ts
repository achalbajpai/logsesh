import type { ExportSession, ExportTurn, JsonExportEnvelope, PublicWarning } from "../types.js";
import { generatedAt } from "../schemas.js";

export function exportJsonEnvelope(
  records: Array<ExportSession | ExportTurn>,
  granularity: "session" | "turn",
  warnings?: PublicWarning[],
): JsonExportEnvelope<ExportSession | ExportTurn> {
  return {
    format: "logsesh.export.v1",
    generatedAt: generatedAt(),
    granularity,
    records,
    warnings,
  };
}

export function serializeJsonEnvelope(
  envelope: JsonExportEnvelope<ExportSession | ExportTurn>,
): string {
  return JSON.stringify(envelope, null, 2);
}
