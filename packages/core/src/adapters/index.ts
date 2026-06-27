import type { Adapter, DiscoverOptions, ToolName, Warning } from "../types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { geminiAdapter } from "./gemini.js";
import { detectRootAccess } from "../fs-walk.js";
import { homedir } from "node:os";
import { join } from "node:path";

const ALL_ADAPTERS: Adapter[] = [claudeCodeAdapter, codexAdapter, geminiAdapter];

const ROOTS: Record<ToolName, (opts: DiscoverOptions) => string> = {
  "claude-code": (opts) => opts.roots?.["claude-code"] ?? join(homedir(), ".claude", "projects"),
  codex: (opts) => opts.roots?.codex ?? join(homedir(), ".codex", "sessions"),
  gemini: (opts) => opts.roots?.gemini ?? join(homedir(), ".gemini", "tmp"),
};

export function getAdapterRoot(tool: ToolName, opts: DiscoverOptions = {}): string {
  return ROOTS[tool](opts);
}

export function getAllAdapters(): Adapter[] {
  return ALL_ADAPTERS;
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
    const root = ROOTS[adapter.tool](opts ?? {});
    const { accessible, warning } = await detectRootAccess(root, adapter.tool);
    if (warning && detectWarnings) detectWarnings.push(warning);
    if (accessible) enabled.push(adapter);
  }
  return enabled;
}

export { claudeCodeAdapter, codexAdapter, geminiAdapter };

const VALID_TOOLS = new Set<ToolName>(["claude-code", "codex", "gemini"]);

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
      errors.push(`Invalid --roots tool "${tool}". Expected: claude-code, codex, gemini`);
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
