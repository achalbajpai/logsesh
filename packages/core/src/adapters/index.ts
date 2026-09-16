import { homedir } from "node:os";
import { join } from "node:path";
import {
  CODEX_ARCHIVE_ROOT_SEGMENTS,
  DEFAULT_LOG_ROOT_SEGMENTS,
  TOOL_NAMES,
  VALID_TOOLS,
} from "../constants.js";
import { detectRootAccess } from "../fs-walk.js";
import type { Adapter, DiscoverOptions, ToolName, Warning } from "../types.js";
import { antigravityAdapter, getAntigravityHomes, resolveAntigravityRoot } from "./antigravity.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { geminiAdapter } from "./gemini.js";

const ALL_ADAPTERS: Adapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  antigravityAdapter,
  geminiAdapter,
];

const ROOTS: Record<ToolName, (opts: DiscoverOptions) => string> = {
  "claude-code": (opts) =>
    opts.roots?.["claude-code"] ?? join(homedir(), ...DEFAULT_LOG_ROOT_SEGMENTS["claude-code"]),
  codex: (opts) => opts.roots?.codex ?? join(homedir(), ...DEFAULT_LOG_ROOT_SEGMENTS.codex),
  antigravity: (opts) => resolveAntigravityRoot(opts),
  gemini: (opts) => opts.roots?.gemini ?? join(homedir(), ...DEFAULT_LOG_ROOT_SEGMENTS.gemini),
};

export function getAdapterRoot(tool: ToolName, opts: DiscoverOptions = {}): string {
  return ROOTS[tool](opts);
}

export function getCodexArchiveRoot(opts: DiscoverOptions = {}): string | undefined {
  if (opts.roots?.codex) return undefined;
  return join(homedir(), ...CODEX_ARCHIVE_ROOT_SEGMENTS);
}

export function getAllAdapters(): Adapter[] {
  return ALL_ADAPTERS;
}

async function toolAccessible(
  adapter: Adapter,
  opts: DiscoverOptions,
  detectWarnings?: Warning[],
): Promise<boolean> {
  const root = ROOTS[adapter.tool](opts);
  const { accessible, warning } = await detectRootAccess(root, adapter.tool);
  if (warning && detectWarnings) detectWarnings.push(warning);
  if (accessible) return true;
  if (adapter.tool === "codex") {
    const archive = getCodexArchiveRoot(opts);
    if (!archive) return false;
    const archived = await detectRootAccess(archive, adapter.tool);
    if (archived.warning && detectWarnings) detectWarnings.push(archived.warning);
    return archived.accessible;
  }
  if (adapter.tool !== "antigravity") return false;
  for (const home of getAntigravityHomes(opts)) {
    if (home === root) continue;
    const extra = await detectRootAccess(home, adapter.tool);
    if (extra.warning && detectWarnings) detectWarnings.push(extra.warning);
    if (extra.accessible) return true;
  }
  return false;
}

export async function getEnabledAdapters(
  toolFilter?: ToolName[],
  detectWarnings?: Warning[],
  opts?: DiscoverOptions,
): Promise<Adapter[]> {
  const adapters = toolFilter
    ? ALL_ADAPTERS.filter((a) => toolFilter.includes(a.tool))
    : ALL_ADAPTERS;

  const enabled: Adapter[] = [];
  for (const adapter of adapters) {
    if (await toolAccessible(adapter, opts ?? {}, detectWarnings)) enabled.push(adapter);
  }
  return enabled;
}

export {
  antigravityAdapter,
  claudeCodeAdapter,
  codexAdapter,
  geminiAdapter,
  getAntigravityHomes,
  resolveAntigravityRoot,
};

export interface ParseRootsResult {
  roots: Partial<Record<ToolName, string>>;
  errors: string[];
}

export function parseRootsOverride(specs: string[]): ParseRootsResult {
  const roots: Partial<Record<ToolName, string>> = {};
  const errors: string[] = [];

  for (const spec of specs) {
    const idx = spec.indexOf(":");
    if (idx <= 0) {
      errors.push(`Invalid --roots spec "${spec}". Expected tool:path (e.g. codex:/tmp/logs)`);
      continue;
    }
    const tool = spec.slice(0, idx);
    const path = spec.slice(idx + 1);
    if (!path) {
      errors.push(`Invalid --roots spec "${spec}". Path must not be empty`);
      continue;
    }
    if (!VALID_TOOLS.has(tool as ToolName)) {
      errors.push(`Invalid --roots tool "${tool}". Expected: ${TOOL_NAMES.join(", ")}`);
      continue;
    }
    const key = tool as ToolName;
    if (roots[key]) {
      errors.push(`Duplicate --roots entry for tool "${tool}"`);
      continue;
    }
    roots[key] = path;
  }

  return { roots, errors };
}
