import type { Adapter, DiscoverOptions, Session, SessionFile, ToolName, Warning } from "./types.js";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "./constants.js";
import { getEnabledAdapters } from "./adapters/index.js";
import {
  type ParsedQuery,
  hasTextQuery,
  matchesQuery,
  parseQuery,
  parseToolField,
} from "./query.js";

export async function* discoverFiles(
  opts: DiscoverOptions,
  adapters: Adapter[],
  onError?: (tool: ToolName, cause: unknown) => void,
): AsyncIterable<SessionFile> {
  for (const adapter of adapters) {
    try {
      for await (const file of adapter.discover(opts)) {
        yield file;
      }
    } catch (err) {
      if (onError) {
        onError(adapter.tool, err);
        continue;
      }
      throw new DiscoveryError(adapter.tool, err);
    }
  }
}

export class DiscoveryError extends Error {
  readonly tool: ToolName;
  readonly causeMessage: string;

  constructor(tool: ToolName, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to discover ${tool} logs: ${causeMessage}`);
    this.name = "DiscoveryError";
    this.tool = tool;
    this.causeMessage = causeMessage;
  }
}

export async function* discover(
  opts: DiscoverOptions = {},
  adapters?: Adapter[],
): AsyncIterable<{ file: SessionFile; warnings: Warning[] }> {
  const warnings: Warning[] = [];
  const enabled = adapters ?? (await getEnabledAdapters(opts.toolFilter, warnings, opts));

  for await (const file of discoverFiles(opts, enabled)) {
    yield { file, warnings: [...warnings] };
  }
}

export function parseDateFilter(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const relative = value.match(/^(\d+)([dhm])$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const ms =
      unit === "d"
        ? amount * MS_PER_DAY
        : unit === "h"
          ? amount * MS_PER_HOUR
          : amount * MS_PER_MINUTE;
    return new Date(Date.now() - ms);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function looksLikeProjectPath(filter: string): boolean {
  return filter.includes("/") || filter.startsWith("~") || filter.startsWith(".");
}

export function matchesProject(
  sessionPath: string | undefined,
  filter: string | undefined,
): boolean {
  if (!filter) return true;
  if (!sessionPath) return false;
  const normalizedSession = sessionPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedFilter = filter.replace(/\\/g, "/").replace(/\/$/, "");

  if (looksLikeProjectPath(normalizedFilter)) {
    return (
      normalizedSession === normalizedFilter || normalizedSession.startsWith(`${normalizedFilter}/`)
    );
  }

  const needle = normalizedFilter.toLowerCase();
  const segments = normalizedSession.split("/").filter(Boolean);
  if (segments.some((segment) => segment.toLowerCase() === needle)) return true;
  const basename = segments[segments.length - 1] ?? "";
  return basename.toLowerCase() === needle;
}

export function matchesTool(tool: ToolName, filter: ToolName[] | undefined): boolean {
  if (!filter || filter.length === 0) return true;
  return filter.includes(tool);
}

export function matchesDateRange(
  startedAt: string | undefined,
  endedAt: string | undefined,
  since?: Date,
  until?: Date,
): boolean {
  const ts = endedAt ?? startedAt;
  if (!ts) return !since && !until;
  const date = new Date(ts);
  if (since && date < since) return false;
  if (until && date > until) return false;
  return true;
}

function sessionTranscriptHaystack(session: Session): string {
  return session.turns
    .filter((t) => t.role === "user" || t.role === "assistant")
    .flatMap((t) => t.content)
    .filter((b) => b.kind === "text")
    .map((b) => (b.kind === "text" ? b.text : ""))
    .join("\n");
}

export function matchesSessionFilters(
  session: Session,
  parsed: ParsedQuery,
  projectFilter?: string | string[],
): boolean {
  const projectFilters =
    typeof projectFilter === "string" ? [projectFilter] : (projectFilter ?? []);
  if (
    projectFilters.length > 0 &&
    !projectFilters.some((filter) => matchesProject(session.projectPath, filter))
  ) {
    return false;
  }
  if (parsed.fields.project?.length) {
    const matchesProjectField = parsed.fields.project.some((value) =>
      matchesProject(session.projectPath, value),
    );
    if (!matchesProjectField) return false;
  }
  if (parsed.fields.tool?.length) {
    const matchesToolField = parsed.fields.tool.some((value) => {
      const tool = parseToolField(value);
      return tool
        ? session.tool === tool
        : session.tool.toLowerCase().includes(value.toLowerCase());
    });
    if (!matchesToolField) return false;
  }
  if (parsed.fields.model?.length) {
    const model = session.model?.toLowerCase() ?? "";
    if (!parsed.fields.model.some((value) => model.includes(value.toLowerCase()))) return false;
  }
  if (parsed.fields.agent?.length) {
    const haystack = [
      session.lineage?.agentId,
      session.lineage?.agentType,
      session.lineage?.originator,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    if (!parsed.fields.agent.some((value) => haystack.includes(value.toLowerCase()))) {
      return false;
    }
  }
  if (parsed.fields.parent?.length) {
    const parent = session.lineage?.parentSessionId ?? "";
    if (!parsed.fields.parent.some((value) => parent.toLowerCase().includes(value.toLowerCase()))) {
      return false;
    }
  }
  if (parsed.fields.branch?.length) {
    const branch = session.branch ?? "";
    if (!parsed.fields.branch.some((value) => branch.toLowerCase().includes(value.toLowerCase()))) {
      return false;
    }
  }
  if (parsed.fields.toolcall?.length) {
    const names = session.turns.flatMap((turn) => (turn.toolCalls ?? []).map((call) => call.name));
    const haystack = names.join("\n").toLowerCase();
    if (!parsed.fields.toolcall.some((value) => haystack.includes(value.toLowerCase()))) {
      return false;
    }
  }
  return true;
}

export function matchesSessionTextQuery(session: Session, parsed: ParsedQuery): boolean {
  if (!hasTextQuery(parsed)) return true;
  return matchesQuery(sessionTranscriptHaystack(session), parsed);
}

export function matchesSessionQuery(
  session: Session,
  query?: string,
  projectFilter?: string | string[],
): boolean {
  const parsed = parseQuery(query ?? "");
  if (!matchesSessionFilters(session, parsed, projectFilter)) return false;
  return matchesSessionTextQuery(session, parsed);
}
