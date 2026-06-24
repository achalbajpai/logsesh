import type {
  ContentBlock,
  ExportSession,
  PublicSession,
  PublicTurn,
  PublicWarning,
  RawPathPublicSession,
  RawPathReasoningSession,
  ReasoningSession,
  SanitizeOptions,
  Session,
  Turn,
  Warning,
} from "./types.js";
import { anonymizePath } from "./util.js";

function stripThinking(blocks: ContentBlock[]): PublicTurn["content"] {
  return blocks.filter((b): b is PublicTurn["content"][number] => b.kind !== "thinking");
}

function anonymizeWarning(w: Warning): PublicWarning {
  const { sourcePath: _sourcePath, ...rest } = w;
  return rest;
}

function anonymizeSessionPaths(session: Session, home = process.env.HOME ?? ""): Session {
  return {
    ...session,
    projectPath: session.projectPath
      ? anonymizePath(session.projectPath, home)
      : session.projectPath,
    warnings: session.warnings?.map((w) => ({
      ...w,
      sourcePath: w.sourcePath ? anonymizePath(w.sourcePath, home) : w.sourcePath,
    })),
  };
}

function toPublicTurns(turns: Turn[], includeReasoning: boolean): PublicTurn[] | Turn[] {
  if (includeReasoning) return turns;
  return turns.map((t) => ({
    ...t,
    content: stripThinking(t.content),
  }));
}

export function sanitizeForExport(
  session: Session,
  opts: SanitizeOptions & { includeReasoning: true; rawPaths: true },
): RawPathReasoningSession;
export function sanitizeForExport(
  session: Session,
  opts: SanitizeOptions & { rawPaths: true; includeReasoning?: false | undefined },
): RawPathPublicSession;
export function sanitizeForExport(
  session: Session,
  opts: SanitizeOptions & { includeReasoning: true; rawPaths?: false | undefined },
): ReasoningSession;
export function sanitizeForExport(session: Session, opts?: SanitizeOptions): PublicSession;
export function sanitizeForExport(session: Session, opts: SanitizeOptions = {}): ExportSession {
  const includeReasoning = opts.includeReasoning ?? false;
  const rawPaths = opts.rawPaths ?? false;
  const base = rawPaths ? session : anonymizeSessionPaths(session);

  const turns = toPublicTurns(base.turns, includeReasoning);
  const { source, warnings, ...rest } = base;

  if (rawPaths && includeReasoning) {
    return { ...rest, turns: turns as Turn[], source, warnings } as RawPathReasoningSession;
  }
  if (rawPaths) {
    return { ...rest, turns: turns as PublicTurn[], source, warnings } as RawPathPublicSession;
  }
  if (includeReasoning) {
    return {
      ...rest,
      turns: turns as Turn[],
      source: {
        tool: source.tool,
        adapterVersion: source.adapterVersion,
        logFormatVersion: source.logFormatVersion,
      },
      warnings: warnings?.map(anonymizeWarning),
    } as ReasoningSession;
  }

  return {
    ...rest,
    turns: turns as PublicTurn[],
    source: {
      tool: source.tool,
      adapterVersion: source.adapterVersion,
      logFormatVersion: source.logFormatVersion,
    },
    warnings: warnings?.map(anonymizeWarning),
  } as PublicSession;
}
