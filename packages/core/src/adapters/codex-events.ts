import { posix as posixPath } from "node:path";
import type { AgentLineage, Usage } from "../types.js";
import { CODEX_IGNORED_PAYLOAD_TYPES } from "../constants.js";
import {
  codexFunctionCallOutputPayloadSchema,
  codexFunctionCallPayloadSchema,
  codexMessagePayloadSchema,
  codexWebSearchPayloadSchema,
  parseCodexPayload,
  requireCallId,
} from "./codex-schemas.js";

export type CodexDispatch =
  | { kind: "skip" }
  | { kind: "unknown"; type?: string }
  | { kind: "ignored"; type: string }
  | { kind: "message"; role: "user" | "assistant"; text: string }
  | { kind: "skipped_role"; role: string }
  | { kind: "reasoning"; summary?: string; encrypted: boolean }
  | { kind: "tool_call"; id: string; name: string; input?: unknown }
  | { kind: "tool_result"; id: string; output?: unknown; error?: boolean };

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function dispatchCodexPayload(
  payload: Record<string, unknown> | undefined,
  lineNumber: number,
): CodexDispatch {
  if (!payload || typeof payload.type !== "string") return { kind: "skip" };
  const type = payload.type;

  if (CODEX_IGNORED_PAYLOAD_TYPES.has(type)) return { kind: "ignored", type };

  if (type === "message") {
    const parsed = parseCodexPayload(codexMessagePayloadSchema, payload);
    if (!parsed) return { kind: "unknown", type };
    if (parsed.role === "developer" || parsed.role === "system") {
      return { kind: "skipped_role", role: parsed.role };
    }
    if (parsed.role !== "user" && parsed.role !== "assistant") return { kind: "ignored", type };
    const text = messageText(parsed.content);
    if (!text) return { kind: "ignored", type };
    return { kind: "message", role: parsed.role, text };
  }

  if (type === "reasoning") {
    return {
      kind: "reasoning",
      encrypted: Boolean(payload.encrypted_content),
      summary: typeof payload.summary === "string" ? payload.summary : messageText(payload.content),
    };
  }

  if (type === "function_call" || type === "custom_tool_call") {
    const functionCall = parseCodexPayload(codexFunctionCallPayloadSchema, payload);
    if (!functionCall) return { kind: "unknown", type };
    const callId = requireCallId(functionCall.call_id ?? functionCall.id);
    if (!callId) return { kind: "ignored", type };
    return {
      kind: "tool_call",
      id: callId,
      name: typeof functionCall.name === "string" ? functionCall.name : "unknown",
      input: functionCall.arguments ?? functionCall.input,
    };
  }

  if (type === "function_call_output" || type === "custom_tool_call_output") {
    const functionOutput = parseCodexPayload(codexFunctionCallOutputPayloadSchema, payload);
    if (!functionOutput) return { kind: "unknown", type };
    return {
      kind: "tool_result",
      id: functionOutput.call_id,
      output: functionOutput.output,
      error: functionOutput.is_error,
    };
  }

  if (type === "web_search_call") {
    const webSearch = parseCodexPayload(codexWebSearchPayloadSchema, payload);
    if (!webSearch) return { kind: "unknown", type };
    const callId = requireCallId(webSearch.call_id, `web-${lineNumber}`);
    if (!callId) return { kind: "ignored", type };
    return { kind: "tool_call", id: callId, name: "web_search", input: payload };
  }

  if (type === "tool_search_call") {
    const callId = requireCallId(
      typeof payload.call_id === "string"
        ? payload.call_id
        : typeof payload.id === "string"
          ? payload.id
          : undefined,
    );
    if (!callId) return { kind: "ignored", type };
    return {
      kind: "tool_call",
      id: callId,
      name: "tool_search",
      input: payload.arguments ?? payload,
    };
  }

  if (type === "tool_search_output") {
    const callId = requireCallId(typeof payload.call_id === "string" ? payload.call_id : undefined);
    if (!callId) return { kind: "ignored", type };
    return {
      kind: "tool_result",
      id: callId,
      output: "tools" in payload ? payload.tools : payload,
    };
  }

  if (type === "agent_message") {
    const text =
      typeof payload.content === "string" ? payload.content : messageText(payload.content);
    if (!text) return { kind: "ignored", type };
    return { kind: "message", role: "assistant", text };
  }

  return { kind: "unknown", type };
}

export function mapCodexUsage(u: {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}): Usage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cached_input_tokens,
    reasoningTokens: u.reasoning_output_tokens,
    totalTokens: u.total_tokens,
  };
}

export function lineageFromCodexMeta(meta: {
  id?: string;
  session_id?: string;
  originator?: string;
  parent_thread_id?: string;
  forked_from_id?: string;
  thread_source?: string;
  agent_nickname?: string;
  agent_path?: string;
  source?: unknown;
}): AgentLineage | undefined {
  if (meta.thread_source !== "subagent") return undefined;
  const spawn =
    meta.source && typeof meta.source === "object" && "subagent" in meta.source
      ? (
          meta.source as {
            subagent?: {
              thread_spawn?: { depth?: number; agent_nickname?: string; agent_path?: string };
            };
          }
        ).subagent?.thread_spawn
      : undefined;
  const agentPath = spawn?.agent_path ?? meta.agent_path;
  const agentType =
    spawn?.agent_nickname ??
    meta.agent_nickname ??
    (typeof agentPath === "string" ? posixPath.basename(agentPath.replace(/\\/g, "/")) : undefined);
  return {
    parentSessionId: meta.parent_thread_id ?? meta.forked_from_id ?? meta.session_id,
    agentId: meta.id,
    agentType,
    originator: meta.originator,
    depth: spawn?.depth,
  };
}
