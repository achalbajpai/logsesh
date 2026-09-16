import { elideBinaryString, elideStoredValue } from "./elide.js";
import { LOG_FORMAT_VERSION_UNKNOWN, SESSION_SCHEMA_VERSION } from "./constants.js";
import type {
  AddRecordInput,
  AddToolResultInput,
  AgentLineage,
  ContentBlock,
  InputContentBlock,
  Session,
  SessionBuilderOptions,
  SourceFidelity,
  ToolCall,
  Turn,
  Usage,
  Warning,
} from "./types.js";

interface FragmentEntry {
  sourceLine: number;
  blocks: InputContentBlock[];
  timestamp?: string;
}

interface PendingTurn {
  sourceLine: number;
  turn: Omit<Turn, "index">;
}

export interface ObserveUsageInput {
  mode: "delta" | "cumulative";
  usage: Usage;
  key?: string;
}

function blocksEqual(a: InputContentBlock, b: InputContentBlock): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "text" && b.kind === "text") return a.text === b.text;
  if (a.kind === "thinking" && b.kind === "thinking") return a.text === b.text;
  if (a.kind === "tool_use" && b.kind === "tool_use") return a.id === b.id;
  if (a.kind === "image" && b.kind === "image") {
    return a.mediaType === b.mediaType && a.bytes === b.bytes && a.note === b.note;
  }
  return false;
}

function dedupeBlocks(blocks: InputContentBlock[]): InputContentBlock[] {
  const result: InputContentBlock[] = [];
  const seenToolIds = new Set<string>();

  for (const block of blocks) {
    if (block.kind === "tool_use") {
      if (seenToolIds.has(block.id)) continue;
      seenToolIds.add(block.id);
      result.push(block);
      continue;
    }
    if (result.some((existing) => blocksEqual(existing, block))) continue;
    result.push(block);
  }

  return result;
}

function toContentBlock(block: InputContentBlock): ContentBlock {
  switch (block.kind) {
    case "text":
      return { kind: "text", text: block.text };
    case "thinking":
      return { kind: "thinking", text: block.text };
    case "image":
      return {
        kind: "image",
        mediaType: block.mediaType,
        bytes: block.bytes,
        note: block.note ?? "[image omitted]",
      };
    case "tool_use":
      return { kind: "tool_use", id: block.id, name: block.name, input: block.input };
  }
}

function extractToolCalls(blocks: ContentBlock[]): ToolCall[] {
  return blocks
    .filter((b): b is Extract<ContentBlock, { kind: "tool_use" }> => b.kind === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

function mergeUsage(existing: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!next) return existing;
  if (!existing) return { ...next };
  return {
    inputTokens: (existing.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (existing.outputTokens ?? 0) + (next.outputTokens ?? 0),
    cacheReadTokens: (existing.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0),
    cacheWriteTokens: (existing.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0),
    reasoningTokens: (existing.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
    totalTokens: (existing.totalTokens ?? 0) + (next.totalTokens ?? 0),
  };
}

function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max) + "...", truncated: true };
}

function lineageHasEvidence(lineage: AgentLineage): boolean {
  return (
    lineage.role !== undefined ||
    lineage.parentSessionId !== undefined ||
    lineage.agentId !== undefined ||
    lineage.agentType !== undefined ||
    lineage.originator !== undefined ||
    lineage.depth !== undefined
  );
}

function boundToolOutput(
  output: unknown,
  maxChars: number,
): { value: unknown; truncated: boolean } {
  if (output === undefined) return { value: output, truncated: false };
  if (typeof output === "string") {
    const { text, truncated } = truncateText(output, maxChars);
    return { value: text, truncated };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    serialized = "[unserializable output]";
  }

  if (serialized.length <= maxChars) {
    return { value: output, truncated: false };
  }

  const { text } = truncateText(serialized, maxChars);
  return { value: text, truncated: true };
}

export class SessionBuilder {
  private readonly sourcePath: string;
  private readonly tool: SessionBuilderOptions["tool"];
  private readonly adapterVersion: string;
  private readonly maxTurnChars: number | undefined;
  private readonly maxToolOutputChars: number | undefined;
  private sessionId: string;
  private projectPath: string | undefined;
  private model: string | undefined;
  private logFormatVersion: string | undefined;
  private branch: string | undefined;
  private lineage: AgentLineage | undefined;
  private lifecycle: "active" | "archived" | undefined;
  private readonly warnings: Warning[] = [];
  private readonly fragments = new Map<string, FragmentEntry[]>();
  private readonly fragmentUsage = new Map<string, Usage>();
  private readonly pendingTurns: PendingTurn[] = [];
  private readonly toolCallsById = new Map<string, ToolCall>();
  private readonly seenOrdinals = new Set<number>();
  private readonly partialReasons = new Set<string>();
  private timestamps: string[] = [];
  private turnCounter = 0;
  private finalizedSession: Session | null = null;
  private usageMode: "delta" | "cumulative" | undefined;
  private cumulativeUsage: Usage | undefined;
  private wholeFileSkip = false;
  private recordsObserved = 0;
  private recordsRecognized = 0;
  private recordsUnknown = 0;
  private recordsMalformed = 0;
  private recordsOversized = 0;

  constructor(opts: SessionBuilderOptions) {
    this.tool = opts.tool;
    this.adapterVersion = opts.adapterVersion;
    this.sourcePath = opts.sourcePath;
    this.sessionId = opts.sessionId;
    this.projectPath = opts.projectPath;
    this.model = opts.model;
    this.logFormatVersion = opts.logFormatVersion;
    this.maxTurnChars = opts.maxTurnChars;
    this.maxToolOutputChars = opts.maxToolOutputChars;
  }

  addWarning(warning: Warning): void {
    this.ensureOpen();
    this.warnings.push(warning);
  }

  setSessionId(sessionId: string): void {
    this.ensureOpen();
    this.sessionId = sessionId;
  }

  setProjectPath(projectPath: string | undefined): void {
    this.ensureOpen();
    if (projectPath === undefined) return;
    this.projectPath = projectPath;
  }

  setModel(model: string | undefined): void {
    this.ensureOpen();
    if (model === undefined) return;
    this.model = model;
  }

  setLogFormatVersion(version: string | undefined): void {
    this.ensureOpen();
    if (version === undefined) return;
    this.logFormatVersion = version;
  }

  setBranch(branch: string | undefined): void {
    this.ensureOpen();
    if (branch === undefined) return;
    this.branch = branch;
  }

  setLineage(lineage: AgentLineage): void {
    this.ensureOpen();
    const next: AgentLineage = { ...this.lineage };
    if (lineage.role !== undefined) next.role = lineage.role;
    if (lineage.parentSessionId !== undefined) next.parentSessionId = lineage.parentSessionId;
    if (lineage.agentId !== undefined) next.agentId = lineage.agentId;
    if (lineage.agentType !== undefined) next.agentType = lineage.agentType;
    if (lineage.originator !== undefined) next.originator = lineage.originator;
    if (lineage.depth !== undefined) next.depth = lineage.depth;
    this.lineage = next;
  }

  setSourceLifecycle(lifecycle: "active" | "archived"): void {
    this.ensureOpen();
    if (this.lifecycle !== undefined && this.lifecycle !== lifecycle) {
      this.addWarning({
        code: "source_changed_during_scan",
        message: `Source lifecycle changed from ${this.lifecycle} to ${lifecycle}`,
        severity: "warn",
        scope: "parse",
        sourcePath: this.sourcePath,
        sessionId: this.sessionId,
      });
    }
    this.lifecycle = lifecycle;
  }

  markPartial(reason: string): void {
    this.ensureOpen();
    this.partialReasons.add(reason);
  }

  markWholeFileSkip(): void {
    this.ensureOpen();
    this.wholeFileSkip = true;
  }

  noteObservedRecord(): void {
    this.ensureOpen();
    this.recordsObserved += 1;
  }

  noteUnknownRecord(): void {
    this.ensureOpen();
    this.recordsUnknown += 1;
  }

  noteMalformedRecord(): void {
    this.ensureOpen();
    this.recordsMalformed += 1;
  }

  noteOversizedRecord(): void {
    this.ensureOpen();
    this.recordsOversized += 1;
  }

  observeUsage(input: ObserveUsageInput): void {
    this.ensureOpen();
    if (this.usageMode !== undefined && this.usageMode !== input.mode) {
      this.addWarning({
        code: "unsupported_usage_shape",
        message: `Usage mixing ${input.mode} with ${this.usageMode}; keeping ${this.usageMode}`,
        severity: "warn",
        scope: "parse",
        sourcePath: this.sourcePath,
        sessionId: this.sessionId,
      });
      return;
    }
    this.usageMode = input.mode;
    if (input.mode === "cumulative") {
      this.cumulativeUsage = { ...input.usage };
      return;
    }
    const key = input.key ?? "";
    this.fragmentUsage.set(key, input.usage);
  }

  observeSequence(ordinal: number): void {
    this.ensureOpen();
    if (this.seenOrdinals.has(ordinal)) {
      this.addWarning({
        code: "duplicate_event_ordinal",
        message: `Duplicate event ordinal ${ordinal}`,
        severity: "warn",
        scope: "parse",
        sourcePath: this.sourcePath,
        sessionId: this.sessionId,
      });
    }
    this.seenOrdinals.add(ordinal);
  }

  addRecord(input: AddRecordInput): void {
    this.ensureOpen();
    this.recordsRecognized += 1;
    if (input.timestamp) this.timestamps.push(input.timestamp);
    if (input.usage) {
      this.observeUsage({
        mode: "delta",
        usage: input.usage,
        key: input.fragmentGroupId,
      });
    }

    if (input.role === "assistant" && input.fragmentGroupId) {
      const groupId = input.fragmentGroupId;
      const entries = this.fragments.get(groupId) ?? [];
      entries.push({
        sourceLine: input.sourceLine,
        blocks: input.blocks,
        timestamp: input.timestamp,
      });
      this.fragments.set(groupId, entries);
      this.registerToolCallsFromBlocks(input.blocks);
      return;
    }

    const turn = this.buildTurnFromBlocks({
      role: input.role,
      sourceLine: input.sourceLine,
      blocks: input.blocks,
      timestamp: input.timestamp,
    });
    this.pendingTurns.push({ sourceLine: input.sourceLine, turn });
    this.registerToolCalls(turn);
  }

  addToolResult(input: AddToolResultInput): void {
    this.ensureOpen();
    this.recordsRecognized += 1;
    const maxOut = this.maxToolOutputChars ?? 50_000;
    const elided = elideStoredValue(input.output);
    const { value: output, truncated } = boundToolOutput(elided, maxOut);
    if (truncated) {
      this.addWarning({
        code: "truncated_tool_output",
        message: `Tool output truncated at ${maxOut} characters`,
        severity: "warn",
        scope: "parse",
        sourcePath: this.sourcePath,
        sessionId: this.sessionId,
        line: input.sourceLine,
      });
    }

    const matched = this.toolCallsById.get(input.toolUseId);
    if (matched) {
      matched.output = output;
      matched.status = input.status ?? "success";
    } else {
      this.addWarning({
        code: "unmatched_tool_result",
        message: `Tool result with no matching call: ${input.toolUseId}`,
        severity: "warn",
        scope: "parse",
        sourcePath: this.sourcePath,
        sessionId: this.sessionId,
        line: input.sourceLine,
      });
    }

    const turn: Omit<Turn, "index"> = {
      id: `tool-result-${input.toolUseId}-${input.sourceLine}`,
      timestamp: undefined,
      role: "tool",
      content: [
        {
          kind: "tool_result",
          toolUseId: input.toolUseId,
          output,
          status: input.status ?? "success",
        },
      ],
    };
    this.pendingTurns.push({ sourceLine: input.sourceLine, turn });
  }

  finalize(): Session {
    if (this.finalizedSession) return this.finalizedSession;

    for (const [groupId, entries] of this.fragments) {
      entries.sort((a, b) => a.sourceLine - b.sourceLine);
      const mergedBlocks = dedupeBlocks(entries.flatMap((e) => e.blocks));
      const sourceLine = entries[0]?.sourceLine ?? 0;
      const timestamp = entries.find((e) => e.timestamp)?.timestamp;

      const turn = this.buildTurnFromBlocks({
        role: "assistant",
        sourceLine,
        blocks: mergedBlocks,
        timestamp,
        id: `assistant-${groupId}`,
      });
      this.applyRegisteredToolOutputs(turn);
      this.pendingTurns.push({ sourceLine, turn });
    }

    this.pendingTurns.sort((a, b) => a.sourceLine - b.sourceLine);

    const turns: Turn[] = this.pendingTurns.map((pending) => ({
      ...pending.turn,
      index: this.turnCounter++,
    }));

    const usage = this.computeSessionUsage();
    const sortedTs = [...this.timestamps].sort();
    const stampedWarnings = this.warnings.map((warning) => ({
      ...warning,
      sessionId: this.sessionId,
    }));

    const session: Session = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: this.sessionId,
      source: {
        tool: this.tool,
        adapterVersion: this.adapterVersion,
        logFormatVersion: this.logFormatVersion ?? LOG_FORMAT_VERSION_UNKNOWN,
        sourcePath: this.sourcePath,
      },
      tool: this.tool,
      startedAt: sortedTs[0],
      endedAt: sortedTs[sortedTs.length - 1],
      projectPath: this.projectPath,
      model: this.model,
      usage,
      costUsd: null,
      turns,
      warnings: stampedWarnings.length > 0 ? stampedWarnings : undefined,
      fidelity: this.deriveFidelity(turns.length),
    };
    if (this.branch !== undefined) session.branch = this.branch;
    if (this.lineage !== undefined && lineageHasEvidence(this.lineage)) {
      session.lineage = this.lineage;
    }
    if (this.lifecycle !== undefined) session.source.lifecycle = this.lifecycle;

    this.finalizedSession = session;
    return session;
  }

  private deriveFidelity(turnCount: number): SourceFidelity {
    const fidelity: SourceFidelity = {
      completeness: "complete",
      recordsObserved: this.recordsObserved,
      recordsRecognized: this.recordsRecognized,
      recordsUnknown: this.recordsUnknown,
      recordsMalformed: this.recordsMalformed,
      recordsOversized: this.recordsOversized,
    };

    if (this.wholeFileSkip) {
      fidelity.completeness = "metadata-only";
      fidelity.reason = "file_too_large";
      return fidelity;
    }

    if (this.partialReasons.size > 0) {
      fidelity.completeness = "partial";
      fidelity.reason = [...this.partialReasons][0];
      return fidelity;
    }

    if (this.recordsRecognized === 0 && turnCount === 0) {
      fidelity.completeness = "metadata-only";
      fidelity.reason = "no_recognized_records";
    }

    return fidelity;
  }

  private computeSessionUsage(): Usage | undefined {
    if (this.usageMode === "cumulative") return this.cumulativeUsage;
    const usages = [...this.fragmentUsage.values()];
    if (usages.length === 0) return undefined;
    return usages.reduce<Usage | undefined>((acc, u) => mergeUsage(acc, u), undefined);
  }

  private registerToolCalls(turn: Omit<Turn, "index">): void {
    for (const tc of turn.toolCalls ?? []) {
      this.toolCallsById.set(tc.id, tc);
    }
  }

  private applyRegisteredToolOutputs(turn: Omit<Turn, "index">): void {
    if (!turn.toolCalls) return;
    for (const tc of turn.toolCalls) {
      const registered = this.toolCallsById.get(tc.id);
      if (registered) {
        if (registered.output !== undefined) tc.output = registered.output;
        if (registered.status !== undefined) tc.status = registered.status;
      }
    }
  }

  private registerToolCallsFromBlocks(blocks: InputContentBlock[]): void {
    for (const block of blocks) {
      if (block.kind !== "tool_use") continue;
      if (!this.toolCallsById.has(block.id)) {
        this.toolCallsById.set(block.id, { id: block.id, name: block.name, input: block.input });
      }
    }
  }

  private buildTurnFromBlocks(input: {
    role: "user" | "assistant";
    sourceLine: number;
    blocks: InputContentBlock[];
    timestamp?: string;
    id?: string;
  }): Omit<Turn, "index"> {
    const maxTurn = this.maxTurnChars ?? 100_000;
    const content: ContentBlock[] = [];

    for (const block of input.blocks) {
      if (block.kind === "text") {
        const elided = elideBinaryString(block.text);
        if (elided) {
          content.push(elided);
          continue;
        }
        const { text, truncated } = truncateText(block.text, maxTurn);
        if (truncated) {
          this.addWarning({
            code: "truncated_turn",
            message: `Turn text truncated at ${maxTurn} characters`,
            severity: "warn",
            scope: "parse",
            sourcePath: this.sourcePath,
            sessionId: this.sessionId,
            line: input.sourceLine,
          });
        }
        content.push({ kind: "text", text });
        continue;
      }
      if (block.kind === "thinking") {
        const { text, truncated } = truncateText(block.text, maxTurn);
        if (truncated) {
          this.addWarning({
            code: "truncated_turn",
            message: `Turn text truncated at ${maxTurn} characters`,
            severity: "warn",
            scope: "parse",
            sourcePath: this.sourcePath,
            sessionId: this.sessionId,
            line: input.sourceLine,
          });
        }
        content.push({ kind: "thinking", text });
        continue;
      }
      content.push(toContentBlock(block));
    }

    const toolCalls = extractToolCalls(content);
    const id =
      input.id ??
      `${input.role}-${input.sourceLine}-${this.pendingTurns.length + this.fragments.size}`;

    return {
      id,
      timestamp: input.timestamp,
      role: input.role,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private ensureOpen(): void {
    if (this.finalizedSession) {
      throw new Error("SessionBuilder cannot be mutated after finalize()");
    }
  }
}
