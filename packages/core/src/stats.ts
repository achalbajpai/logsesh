import type { Session, StatsReport } from "./types.js";
import { anonymizePath } from "./util.js";

function sessionTokens(session: Session): number {
  return (
    session.usage?.totalTokens ??
    (session.usage
      ? (session.usage.inputTokens ?? 0) +
        (session.usage.outputTokens ?? 0) +
        (session.usage.cacheReadTokens ?? 0) +
        (session.usage.cacheWriteTokens ?? 0) +
        (session.usage.reasoningTokens ?? 0)
      : 0)
  );
}

export class StatsAggregator {
  useEstimates = false;
  sessionCount = 0;
  turnCount = 0;
  totalTokens = 0;
  loggedCostUsd = 0;
  loggedSessionCount = 0;
  estimatedCostUsd = 0;
  estimatedSessionCount = 0;
  unpricedSessionCount = 0;
  unpricedTokens = 0;
  byTool: StatsReport["byTool"] = {};
  byProject: StatsReport["byProject"] = {};
  dayCounts = new Map<string, { sessions: number; turns: number }>();

  add(session: Session): void {
    this.sessionCount++;
    this.turnCount += session.turns.length;

    const tokens = sessionTokens(session);
    this.totalTokens += tokens;

    if (session.costUsd !== null) {
      this.loggedCostUsd += session.costUsd;
      this.loggedSessionCount++;
    } else if (this.useEstimates && typeof session.estimate?.costUsd === "number") {
      this.estimatedCostUsd += session.estimate.costUsd;
      this.estimatedSessionCount++;
    } else {
      this.unpricedSessionCount++;
      this.unpricedTokens += tokens;
    }

    const tool = session.tool;
    this.byTool[tool] ??= { sessions: 0, turns: 0, tokens: 0 };
    this.byTool[tool].sessions++;
    this.byTool[tool].turns += session.turns.length;
    this.byTool[tool].tokens += tokens;

    const project = session.projectPath ? anonymizePath(session.projectPath) : "unknown";
    this.byProject[project] ??= { sessions: 0, turns: 0, tokens: 0 };
    this.byProject[project].sessions++;
    this.byProject[project].turns += session.turns.length;
    this.byProject[project].tokens += tokens;

    const day = (session.startedAt ?? session.endedAt ?? "").slice(0, 10);
    if (day) {
      const existing = this.dayCounts.get(day) ?? { sessions: 0, turns: 0 };
      existing.sessions++;
      existing.turns += session.turns.length;
      this.dayCounts.set(day, existing);
    }
  }

  report(): StatsReport {
    const mostActiveDays = [...this.dayCounts.entries()]
      .map(([date, v]) => ({ date, sessions: v.sessions, turns: v.turns }))
      .sort((a, b) => b.sessions - a.sessions || b.turns - a.turns)
      .slice(0, 10);

    return {
      sessionCount: this.sessionCount,
      turnCount: this.turnCount,
      totalTokens: this.totalTokens,
      loggedCostUsd: this.loggedSessionCount > 0 ? this.loggedCostUsd : null,
      loggedSessionCount: this.loggedSessionCount,
      estimatedCostUsd:
        this.useEstimates && this.estimatedSessionCount > 0 ? this.estimatedCostUsd : null,
      estimatedSessionCount: this.estimatedSessionCount,
      unpricedSessionCount: this.unpricedSessionCount,
      unpricedTokens: this.unpricedTokens,
      byTool: this.byTool,
      byProject: this.byProject,
      mostActiveDays,
    };
  }
}
