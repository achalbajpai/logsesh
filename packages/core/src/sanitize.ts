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
  Source,
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

function toPublicTurns(turns: Turn[]): PublicTurn[] {
  return turns.map((t) => ({
    ...t,
    content: stripThinking(t.content),
  }));
}

function publicSource(source: Source): PublicSession["source"] {
  return {
    tool: source.tool,
    adapterVersion: source.adapterVersion,
    logFormatVersion: source.logFormatVersion,
  };
}

type SessionFields = Omit<Session, "turns" | "source" | "warnings">;

function buildRawPathReasoningSession(
  fields: SessionFields,
  turns: Turn[],
  source: Source,
  warnings?: Warning[],
): RawPathReasoningSession {
  return { ...fields, turns, source, warnings };
}

function buildRawPathPublicSession(
  fields: SessionFields,
  turns: PublicTurn[],
  source: Source,
  warnings?: Warning[],
): RawPathPublicSession {
  return { ...fields, turns, source, warnings };
}

function buildReasoningSession(
  fields: SessionFields,
  turns: Turn[],
  source: Source,
  warnings?: Warning[],
): ReasoningSession {
  return {
    ...fields,
    turns,
    source: publicSource(source),
    warnings: warnings?.map(anonymizeWarning),
  };
}

function buildPublicSession(
  fields: SessionFields,
  turns: PublicTurn[],
  source: Source,
  warnings?: Warning[],
): PublicSession {
  return {
    ...fields,
    turns,
    source: publicSource(source),
    warnings: warnings?.map(anonymizeWarning),
  };
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
  const { source, warnings, ...fields } = base;

  if (rawPaths && includeReasoning) {
    return buildRawPathReasoningSession(fields, base.turns, source, warnings);
  }
  if (rawPaths) {
    return buildRawPathPublicSession(fields, toPublicTurns(base.turns), source, warnings);
  }
  if (includeReasoning) {
    return buildReasoningSession(fields, base.turns, source, warnings);
  }

  return buildPublicSession(fields, toPublicTurns(base.turns), source, warnings);
}
