import type { SanitizeOptions, Session, SessionSummary } from "./types.js";
import { anonymizePath } from "./util.js";

export function sessionToSummary(session: Session, opts?: SanitizeOptions): SessionSummary {
  const rawPaths = opts?.rawPaths ?? false;
  const home = process.env.HOME ?? "";
  const projectPath = session.projectPath
    ? rawPaths
      ? session.projectPath
      : anonymizePath(session.projectPath, home)
    : session.projectPath;
  const sourcePath = rawPaths
    ? session.source.sourcePath
    : anonymizePath(session.source.sourcePath, home);

  return {
    id: session.id,
    tool: session.tool,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    projectPath,
    turnCount: session.turns.length,
    totalTokens: session.usage?.totalTokens ?? sumUsage(session.usage),
    costUsd: session.costUsd,
    estimate: session.estimate,
    sourcePath,
  };
}

function sumUsage(usage: Session["usage"]): number | undefined {
  if (!usage) return undefined;
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  const sum =
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0) +
    (usage.reasoningTokens ?? 0);
  return sum > 0 ? sum : undefined;
}
