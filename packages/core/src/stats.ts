import type { Session, StatsReport } from "./types.js";
import { anonymizePath } from "./util.js";

export class StatsAggregator {
  useEstimates = false;
  sessionCount = 0;
  turnCount = 0;
  totalTokens = 0;
  knownCostUsd = 0;
  unknownCostSessionCount = 0;
  byTool: StatsReport["byTool"] = {};
  byProject: StatsReport["byProject"] = {};
  dayCounts = new Map<string, { sessions: number; turns: number }>();

  add(session: Session): void {
    this.sessionCount++;
    this.turnCount += session.turns.length;

    const tokens =
      session.usage?.totalTokens ??
      (session.usage
        ? (session.usage.inputTokens ?? 0) +
          (session.usage.outputTokens ?? 0) +
          (session.usage.cacheReadTokens ?? 0) +
          (session.usage.cacheWriteTokens ?? 0) +
          (session.usage.reasoningTokens ?? 0)
        : 0);
    this.totalTokens += tokens;

    if (session.costUsd !== null) {
      this.knownCostUsd += session.costUsd;
    } else if (this.useEstimates && typeof session.estimate?.costUsd === "number") {
      this.knownCostUsd += session.estimate.costUsd;
    } else {
      this.unknownCostSessionCount++;
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
      knownCostUsd: this.knownCostUsd,
      unknownCostSessionCount: this.unknownCostSessionCount,
      byTool: this.byTool,
      byProject: this.byProject,
      mostActiveDays,
    };
  }
}
