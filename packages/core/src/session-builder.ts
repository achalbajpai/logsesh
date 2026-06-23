import type {
  AddRecordInput,
  AddToolResultInput,
  ContentBlock,
  InputContentBlock,
  Session,
  SessionBuilderOptions,
  ToolCall,
  Turn,
  Usage,
  Warning,
} from "./types.js";

interface FragmentEntry {
  sourceLine: number;
  blocks: InputContentBlock[];
  usage?: Usage;
  timestamp?: string;
}

interface PendingTurn {
  sourceLine: number;
  turn: Omit<Turn, "index">;
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
    serialized = String(output);
  }

  if (serialized.length <= maxChars) {
    return { value: output, truncated: false };
  }

  const { text } = truncateText(serialized, maxChars);
  return { value: text, truncated: true };
}

export class SessionBuilder {
  private readonly opts: SessionBuilderOptions;
  private readonly warnings: Warning[] = [];
  private readonly fragments = new Map<string, FragmentEntry[]>();
  private readonly fragmentUsage = new Map<string, Usage>();
  private readonly pendingTurns: PendingTurn[] = [];
  private readonly toolCallsById = new Map<string, ToolCall>();
  private timestamps: string[] = [];
  private turnCounter = 0;
  private finalizedSession: Session | null = null;

  constructor(opts: SessionBuilderOptions) {
    this.opts = opts;
  }

  addWarning(warning: Warning): void {
    this.warnings.push(warning);
  }

  addRecord(input: AddRecordInput): void {
    if (input.timestamp) this.timestamps.push(input.timestamp);

    if (input.role === "assistant" && input.fragmentGroupId) {
      const groupId = input.fragmentGroupId;
      const entries = this.fragments.get(groupId) ?? [];
      entries.push({
        sourceLine: input.sourceLine,
        blocks: input.blocks,
        usage: input.usage,
        timestamp: input.timestamp,
      });
      this.fragments.set(groupId, entries);
      if (input.usage) {
        this.fragmentUsage.set(groupId, input.usage);
      }
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
    const maxOut = this.opts.maxToolOutputChars ?? 50_000;
    const { value: output, truncated } = boundToolOutput(input.output, maxOut);
    if (truncated) {
      this.addWarning({
        code: "truncated_tool_output",
        message: `Tool output truncated at ${maxOut} characters`,
        severity: "warn",
        scope: "parse",
        sourcePath: this.opts.sourcePath,
        sessionId: this.opts.sessionId,
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
        sourcePath: this.opts.sourcePath,
        sessionId: this.opts.sessionId,
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

    this.finalizedSession = {
      schemaVersion: "logsesh.session.v1",
      id: this.opts.sessionId,
      source: {
        tool: this.opts.tool,
        adapterVersion: this.opts.adapterVersion,
        logFormatVersion: this.opts.logFormatVersion ?? "unknown",
        sourcePath: this.opts.sourcePath,
      },
      tool: this.opts.tool,
      startedAt: sortedTs[0],
      endedAt: sortedTs[sortedTs.length - 1],
      projectPath: this.opts.projectPath,
      model: this.opts.model,
      usage,
      costUsd: null,
      turns,
      warnings: this.warnings.length > 0 ? [...this.warnings] : undefined,
    };
    return this.finalizedSession;
  }

  private computeSessionUsage(): Usage | undefined {
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
    const maxTurn = this.opts.maxTurnChars ?? 100_000;
    const content: ContentBlock[] = [];

    for (const block of input.blocks) {
      if (block.kind === "text" || block.kind === "thinking") {
        const { text, truncated } = truncateText(block.text, maxTurn);
        if (truncated) {
          this.addWarning({
            code: "truncated_turn",
            message: `Turn text truncated at ${maxTurn} characters`,
            severity: "warn",
            scope: "parse",
            sourcePath: this.opts.sourcePath,
            sessionId: this.opts.sessionId,
            line: input.sourceLine,
          });
        }
        content.push(block.kind === "text" ? { kind: "text", text } : { kind: "thinking", text });
      } else {
        content.push(toContentBlock(block));
      }
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
}
