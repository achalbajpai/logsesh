import {
  DOCTOR_CANDIDATE_SCAN_LIMIT,
  DOCTOR_ENVELOPE_FORMAT,
  DOCTOR_SAMPLE_FILE_LIMIT,
  type DoctorEnvelopeFormat,
  EXPORT_DEFAULTS,
  PRICING_STALE_AFTER_MS,
} from "./constants.js";
import {
  getAdapterRoot,
  getAllAdapters,
  getAntigravityHomes,
  getCodexArchiveRoot,
} from "./adapters/index.js";
import { detectRootAccess } from "./fs-walk.js";
import {
  PRICING_AS_OF,
  PRICING_MODEL_COUNT,
  PRICING_SOURCES,
  PRICING_SOURCE_URL,
  PRICING_VERSION,
} from "./pricing.js";
import { generatedAt } from "./schemas.js";
import type {
  AdapterCapabilities,
  DiscoverOptions,
  SessionFile,
  SourceFidelity,
  ToolName,
  Warning,
} from "./types.js";
import { toPublicWarnings } from "./pipeline.js";

export type DoctorFormatHealth = "healthy" | "partial" | "drifted" | "unknown";

export interface DoctorToolReport {
  tool: ToolName;
  detected: boolean;
  root: string;
  rootAccessible: boolean;
  candidateFiles: number;
  candidateFilesCapped?: boolean;
  adapterVersion: string;
  capabilities: AdapterCapabilities;
  permissionIssue?: string;
  sampleFilesChecked?: number;
  recordsObserved?: number;
  recognitionRate?: number;
  unknownRecordTypes?: string[];
  malformedRecords?: number;
  oversizedRecords?: number;
  formatHealth?: DoctorFormatHealth;
}

export interface DoctorReport {
  format: DoctorEnvelopeFormat;
  generatedAt: string;
  tools: DoctorToolReport[];
  pricing: {
    version: string;
    asOf: string;
    sourceUrl: string;
    sources: Array<{
      provider: string;
      url: string;
      asOf: string;
    }>;
    modelCount: number;
    stale?: boolean;
  };
  exportDefaults: typeof EXPORT_DEFAULTS;
  warnings: ReturnType<typeof toPublicWarnings>;
}

function pickSample(files: SessionFile[]): SessionFile[] {
  if (files.length === 0) return [];
  const sample: SessionFile[] = [];
  const first = files[0];
  const last = files[files.length - 1];
  if (first) sample.push(first);
  const interesting = files.find(
    (file) => file.path.includes("subagents") || file.path.includes("archived_sessions"),
  );
  if (interesting && !sample.some((s) => s.path === interesting.path)) sample.push(interesting);
  if (last && !sample.some((s) => s.path === last.path)) sample.push(last);
  return sample.slice(0, DOCTOR_SAMPLE_FILE_LIMIT);
}

function formatHealthFromSample(
  filesChecked: number,
  recordsObserved: number,
  recognized: number,
  ignored: number,
  unknown: number,
): DoctorFormatHealth {
  if (filesChecked === 0) return "unknown";
  if (recordsObserved === 0) return "unknown";
  const rate = (recognized + ignored) / recordsObserved;
  if (rate >= 0.9 && unknown === 0) return "healthy";
  if (rate >= 0.5) return "partial";
  return "drifted";
}

function pricingStale(): boolean {
  const asOf = Date.parse(PRICING_AS_OF);
  if (!Number.isFinite(asOf)) return false;
  return Date.now() - asOf > PRICING_STALE_AFTER_MS;
}

export async function runDoctor(opts: DiscoverOptions = {}): Promise<DoctorReport> {
  const warnings: Warning[] = [];
  const tools: DoctorToolReport[] = [];
  const stale = pricingStale();
  if (stale) {
    warnings.push({
      code: "pricing_stale",
      message: `Bundled pricing table is older than 90 days (as of ${PRICING_AS_OF})`,
      severity: "warn",
      scope: "pricing",
    });
  }

  for (const adapter of getAllAdapters()) {
    const root = getAdapterRoot(adapter.tool, opts);
    const { accessible, warning } = await detectRootAccess(root, adapter.tool);
    if (warning) warnings.push(warning);
    let rootAccessible = accessible;
    if (!rootAccessible && adapter.tool === "codex") {
      const archive = getCodexArchiveRoot(opts);
      if (archive) {
        const archived = await detectRootAccess(archive, adapter.tool);
        if (archived.warning) warnings.push(archived.warning);
        rootAccessible = archived.accessible;
      }
    }
    if (!rootAccessible && adapter.tool === "antigravity") {
      for (const home of getAntigravityHomes(opts)) {
        if (home === root) continue;
        const extra = await detectRootAccess(home, adapter.tool);
        if (extra.warning) warnings.push(extra.warning);
        if (extra.accessible) {
          rootAccessible = true;
          break;
        }
      }
    }

    const discovered: SessionFile[] = [];
    let candidateFilesCapped = false;
    if (rootAccessible) {
      try {
        for await (const file of adapter.discover({ ...opts, toolFilter: [adapter.tool] })) {
          discovered.push(file);
          if (discovered.length >= DOCTOR_CANDIDATE_SCAN_LIMIT) {
            candidateFilesCapped = true;
            break;
          }
        }
      } catch (err) {
        warnings.push({
          code: "discovery_error",
          message: `Failed to discover ${adapter.tool} logs: ${err instanceof Error ? err.message : String(err)}`,
          severity: "warn",
          scope: "discovery",
          sourcePath: root,
          cause: err instanceof Error ? err.name : undefined,
        });
      }
    }

    const sample = pickSample(discovered);
    let recordsObserved = 0;
    let recordsRecognized = 0;
    let recordsIgnored = 0;
    let malformedRecords = 0;
    let oversizedRecords = 0;
    const unknownRecordTypes = new Set<string>();

    for (const file of sample) {
      try {
        for await (const session of adapter.parse(file, {})) {
          const fidelity: SourceFidelity | undefined = session.fidelity;
          recordsObserved += fidelity?.recordsObserved ?? 0;
          recordsRecognized += fidelity?.recordsRecognized ?? 0;
          recordsIgnored += fidelity?.recordsIgnored ?? 0;
          malformedRecords += fidelity?.recordsMalformed ?? 0;
          oversizedRecords += fidelity?.recordsOversized ?? 0;
          for (const type of fidelity?.unknownRecordTypes ?? []) unknownRecordTypes.add(type);
        }
      } catch (err) {
        warnings.push({
          code: "malformed_record",
          message: `Failed to sample ${adapter.tool} log: ${err instanceof Error ? err.message : String(err)}`,
          severity: "warn",
          scope: "parse",
          sourcePath: file.path,
        });
      }
    }

    const unknownTypes = [...unknownRecordTypes].sort();
    tools.push({
      tool: adapter.tool,
      detected: rootAccessible && discovered.length > 0,
      root,
      rootAccessible,
      candidateFiles: discovered.length,
      candidateFilesCapped: candidateFilesCapped || undefined,
      adapterVersion: adapter.adapterVersion,
      capabilities: adapter.capabilities,
      permissionIssue: warning?.cause,
      sampleFilesChecked: sample.length,
      recordsObserved: sample.length > 0 ? recordsObserved : undefined,
      recognitionRate:
        recordsObserved > 0
          ? (recordsRecognized + recordsIgnored) / recordsObserved
          : sample.length > 0
            ? 0
            : undefined,
      unknownRecordTypes: unknownTypes.length > 0 ? unknownTypes : undefined,
      malformedRecords: sample.length > 0 ? malformedRecords : undefined,
      oversizedRecords: sample.length > 0 ? oversizedRecords : undefined,
      formatHealth: formatHealthFromSample(
        sample.length,
        recordsObserved,
        recordsRecognized,
        recordsIgnored,
        unknownTypes.length,
      ),
    });
  }

  return {
    format: DOCTOR_ENVELOPE_FORMAT,
    generatedAt: generatedAt(),
    tools,
    pricing: {
      version: PRICING_VERSION,
      asOf: PRICING_AS_OF,
      sourceUrl: PRICING_SOURCE_URL,
      sources: PRICING_SOURCES,
      modelCount: PRICING_MODEL_COUNT,
      stale: stale || undefined,
    },
    exportDefaults: { ...EXPORT_DEFAULTS },
    warnings: toPublicWarnings(warnings),
  };
}
