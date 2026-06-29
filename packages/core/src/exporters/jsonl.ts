import { JSONL_RECORD_FORMAT } from "../constants.js";
import type { ExportSession, ExportTurn, JsonlRecord, PublicWarning } from "../types.js";
import { generatedAt } from "../schemas.js";

export function exportJsonlRecord(
  record: ExportSession | ExportTurn,
  warnings?: PublicWarning[],
): JsonlRecord<ExportSession | ExportTurn> {
  return {
    format: JSONL_RECORD_FORMAT,
    generatedAt: generatedAt(),
    record,
    warnings,
  };
}

export function serializeJsonlRecord(record: JsonlRecord<ExportSession | ExportTurn>): string {
  return JSON.stringify(record);
}
