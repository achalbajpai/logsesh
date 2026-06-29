import {
  DOCTOR_CANDIDATE_SCAN_LIMIT,
  DOCTOR_ENVELOPE_FORMAT,
  type DoctorEnvelopeFormat,
  EXPORT_DEFAULTS,
} from "./constants.js";
import { getAdapterRoot, getAllAdapters } from "./adapters/index.js";
import { detectRootAccess } from "./fs-walk.js";
import {
  PRICING_AS_OF,
  PRICING_MODEL_COUNT,
  PRICING_SOURCES,
  PRICING_SOURCE_URL,
  PRICING_VERSION,
} from "./pricing.js";
import { generatedAt } from "./schemas.js";
import type { AdapterCapabilities, DiscoverOptions, ToolName, Warning } from "./types.js";
import { toPublicWarnings } from "./pipeline.js";

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
  };
  exportDefaults: typeof EXPORT_DEFAULTS;
  warnings: ReturnType<typeof toPublicWarnings>;
}

export async function runDoctor(opts: DiscoverOptions = {}): Promise<DoctorReport> {
  const warnings: Warning[] = [];
  const tools: DoctorToolReport[] = [];

  for (const adapter of getAllAdapters()) {
    const root = getAdapterRoot(adapter.tool, opts);
    const { accessible, warning } = await detectRootAccess(root, adapter.tool);
    if (warning) warnings.push(warning);

    let candidateFiles = 0;
    let candidateFilesCapped = false;
    if (accessible) {
      try {
        for await (const _file of adapter.discover({ ...opts, toolFilter: [adapter.tool] })) {
          candidateFiles++;
          if (candidateFiles >= DOCTOR_CANDIDATE_SCAN_LIMIT) {
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

    tools.push({
      tool: adapter.tool,
      detected: accessible && candidateFiles > 0,
      root,
      rootAccessible: accessible,
      candidateFiles,
      candidateFilesCapped: candidateFilesCapped || undefined,
      adapterVersion: adapter.adapterVersion,
      capabilities: adapter.capabilities,
      permissionIssue: warning?.cause,
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
    },
    exportDefaults: { ...EXPORT_DEFAULTS },
    warnings: toPublicWarnings(warnings),
  };
}
