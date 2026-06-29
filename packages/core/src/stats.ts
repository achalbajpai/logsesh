import type { Session, StatsReport, TokenBreakdown, Usage } from "./types.js";
import { anonymizePath } from "./util.js";
import {
  MOST_ACTIVE_DAYS_LIMIT,
  TOKEN_CATEGORY_FIELDS,
  UNKNOWN_PROJECT_LABEL,
} from "./constants.js";

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

function emptyTokenBreakdown(): TokenBreakdown {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    observed: {
      input: false,
      output: false,
      cacheRead: false,
      cacheWrite: false,
      reasoning: false,
    },
    observedSessionCount: 0,
  };
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
  dayCounts = new Map<string, { sessions: number; turns: number; tokens: number }>();
  tokenBreakdown = emptyTokenBreakdown();

  add(session: Session): void {
    this.sessionCount++;
    this.turnCount += session.turns.length;

    const tokens = sessionTokens(session);
    this.totalTokens += tokens;

    if (session.usage) {
      let sessionObserved = false;
      for (const [category, field] of Object.entries(TOKEN_CATEGORY_FIELDS) as Array<
        [keyof typeof TOKEN_CATEGORY_FIELDS, keyof Usage]
      >) {
        if (Object.hasOwn(session.usage, field)) {
          sessionObserved = true;
          this.tokenBreakdown[category] += session.usage[field] ?? 0;
          this.tokenBreakdown.observed[category] = true;
        }
      }
      if (sessionObserved) {
        this.tokenBreakdown.observedSessionCount++;
      }
    }

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

    const project = session.projectPath
      ? anonymizePath(session.projectPath)
      : UNKNOWN_PROJECT_LABEL;
    this.byProject[project] ??= { sessions: 0, turns: 0, tokens: 0 };
    this.byProject[project].sessions++;
    this.byProject[project].turns += session.turns.length;
    this.byProject[project].tokens += tokens;

    const day = (session.startedAt ?? session.endedAt ?? "").slice(0, 10);
    if (day) {
      const existing = this.dayCounts.get(day) ?? { sessions: 0, turns: 0, tokens: 0 };
      existing.sessions++;
      existing.turns += session.turns.length;
      existing.tokens += tokens;
      this.dayCounts.set(day, existing);
    }
  }

  report(): StatsReport {
    const mostActiveDays = [...this.dayCounts.entries()]
      .map(([date, v]) => ({ date, sessions: v.sessions, turns: v.turns }))
      .sort((a, b) => b.sessions - a.sessions || b.turns - a.turns)
      .slice(0, MOST_ACTIVE_DAYS_LIMIT);

    const dailyBurn = [...this.dayCounts.entries()]
      .map(([date, v]) => ({
        date,
        sessions: v.sessions,
        turns: v.turns,
        tokens: v.tokens,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

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
      dailyBurn,
      tokenBreakdown: this.tokenBreakdown,
    };
  }
}
