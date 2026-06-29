import { JSON_EXPORT_ENVELOPE_FORMAT } from "../constants.js";
import type { ExportSession, ExportTurn, JsonExportEnvelope, PublicWarning } from "../types.js";
import { generatedAt } from "../schemas.js";

export function exportJsonEnvelope(
  records: Array<ExportSession | ExportTurn>,
  granularity: "session" | "turn",
  warnings?: PublicWarning[],
): JsonExportEnvelope<ExportSession | ExportTurn> {
  return {
    format: JSON_EXPORT_ENVELOPE_FORMAT,
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
