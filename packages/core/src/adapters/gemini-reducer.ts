import { GEMINI_MESSAGE_TYPES } from "../constants.js";
import type { InputContentBlock, Usage } from "../types.js";
import {
  type GeminiEvent,
  classifyGeminiRecord,
  geminiMessageSchema,
  geminiTokensSchema,
  geminiToolCallSchema,
} from "./gemini-schemas.js";

export interface GeminiMessageState {
  id: string;
  timestamp?: string;
  type: string;
  content: unknown;
  toolCalls?: unknown[];
  thoughts?: unknown;
  tokens?: unknown;
  model?: string;
}

export interface GeminiSessionState {
  sessionId?: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  kind?: "main" | "subagent";
  model?: string;
  messages: GeminiMessageState[];
}

function asMessage(raw: unknown, fallbackId: string): GeminiMessageState | undefined {
  const parsed = geminiMessageSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return {
    id: parsed.data.id ?? fallbackId,
    timestamp: parsed.data.timestamp,
    type: parsed.data.type,
    content: parsed.data.content,
    toolCalls: parsed.data.toolCalls,
    thoughts: parsed.data.thoughts,
    tokens: parsed.data.tokens,
    model: parsed.data.model,
  };
}

export function createGeminiState(): GeminiSessionState {
  return { messages: [] };
}

export function applyGeminiEvent(
  state: GeminiSessionState,
  event: GeminiEvent,
  lineNumber: number,
): "recognized" | "ignored" | "unknown" {
  switch (event.kind) {
    case "header": {
      state.sessionId = event.value.sessionId;
      state.projectHash = event.value.projectHash;
      state.startTime = event.value.startTime;
      state.lastUpdated = event.value.lastUpdated;
      state.kind = event.value.kind;
      if (Array.isArray(event.value.messages)) {
        state.messages = event.value.messages
          .map((raw, index) => asMessage(raw, `header-${index}`))
          .filter((msg): msg is GeminiMessageState => Boolean(msg));
      }
      return "recognized";
    }
    case "set": {
      const next = event.value;
      if (typeof next.sessionId === "string") state.sessionId = next.sessionId;
      if (typeof next.projectHash === "string") state.projectHash = next.projectHash;
      if (typeof next.startTime === "string") state.startTime = next.startTime;
      if (typeof next.lastUpdated === "string") state.lastUpdated = next.lastUpdated;
      if (next.kind === "main" || next.kind === "subagent") state.kind = next.kind;
      if (Array.isArray(next.messages)) {
        state.messages = next.messages
          .map((raw, index) => asMessage(raw, `set-${index}`))
          .filter((msg): msg is GeminiMessageState => Boolean(msg));
      }
      return "recognized";
    }
    case "rewind": {
      const idx = state.messages.findIndex((msg) => msg.id === event.messageId);
      if (idx >= 0) state.messages = state.messages.slice(0, idx);
      else state.messages = [];
      return "recognized";
    }
    case "message": {
      if (!GEMINI_MESSAGE_TYPES.has(event.value.type)) return "unknown";
      const next: GeminiMessageState = {
        id: event.value.id ?? `msg-${lineNumber}`,
        timestamp: event.value.timestamp,
        type: event.value.type,
        content: event.value.content,
        toolCalls: event.value.toolCalls,
        thoughts: event.value.thoughts,
        tokens: event.value.tokens,
        model: event.value.model,
      };
      const existing = state.messages.findIndex((msg) => msg.id === next.id);
      if (existing >= 0) state.messages[existing] = next;
      else state.messages.push(next);
      if (event.value.model) state.model = event.value.model;
      return "recognized";
    }
    case "legacy": {
      const role = event.value.role;
      if (role !== "user" && role !== "model") return "ignored";
      state.messages.push({
        id: `legacy-${lineNumber}`,
        timestamp: event.value.timestamp,
        type: role === "model" ? "gemini" : "user",
        content: event.value.parts,
        tokens: event.value.usageMetadata
          ? {
              input: event.value.usageMetadata.promptTokenCount,
              output: event.value.usageMetadata.candidatesTokenCount,
              total: event.value.usageMetadata.totalTokenCount,
            }
          : undefined,
        model: event.value.model ?? event.value.modelVersion,
      });
      if (event.value.model ?? event.value.modelVersion) {
        state.model = event.value.model ?? event.value.modelVersion;
      }
      return "recognized";
    }
    case "unknown":
      return "unknown";
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function thoughtText(thoughts: unknown): string | undefined {
  if (typeof thoughts === "string") return thoughts;
  if (!Array.isArray(thoughts)) return undefined;
  const parts = thoughts
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const rec = item as { subject?: unknown; description?: unknown; text?: unknown };
      if (typeof rec.text === "string") return rec.text;
      return [rec.subject, rec.description].filter((v) => typeof v === "string").join(": ");
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

export function geminiMessageToBlocks(message: GeminiMessageState): {
  role: "user" | "assistant";
  blocks: InputContentBlock[];
  usage?: Usage;
  toolResults: Array<{ id: string; output: unknown; status?: "success" | "error" }>;
} {
  const role: "user" | "assistant" = message.type === "user" ? "user" : "assistant";
  const blocks: InputContentBlock[] = [];
  const toolResults: Array<{ id: string; output: unknown; status?: "success" | "error" }> = [];

  const text = textFromContent(message.content);
  if (text) blocks.push({ kind: "text", text });

  const thinking = thoughtText(message.thoughts);
  if (thinking) blocks.push({ kind: "thinking", text: thinking });

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue;
      const rec = part as {
        functionCall?: { id?: string; name?: string; args?: unknown };
        functionResponse?: { id?: string; response?: unknown };
      };
      if (rec.functionCall) {
        blocks.push({
          kind: "tool_use",
          id: rec.functionCall.id ?? `call-${message.id}`,
          name: rec.functionCall.name ?? "unknown",
          input: rec.functionCall.args,
        });
      }
      if (rec.functionResponse) {
        toolResults.push({
          id: rec.functionResponse.id ?? `call-${message.id}`,
          output: rec.functionResponse.response,
          status: "success",
        });
      }
    }
  }

  for (const raw of message.toolCalls ?? []) {
    const call = geminiToolCallSchema.safeParse(raw);
    if (!call.success) continue;
    const id = call.data.id ?? `call-${message.id}`;
    blocks.push({
      kind: "tool_use",
      id,
      name: call.data.name ?? "unknown",
      input: call.data.args,
    });
    if (call.data.result !== undefined) {
      toolResults.push({
        id,
        output: call.data.result,
        status: call.data.status === "error" ? "error" : "success",
      });
    }
  }

  const tokens = geminiTokensSchema.safeParse(message.tokens);
  const usage = tokens.success
    ? {
        inputTokens: tokens.data.input,
        outputTokens: tokens.data.output,
        cacheReadTokens: tokens.data.cached,
        reasoningTokens: tokens.data.thoughts,
        totalTokens: tokens.data.total,
      }
    : undefined;

  return { role, blocks, usage, toolResults };
}

export { classifyGeminiRecord };
