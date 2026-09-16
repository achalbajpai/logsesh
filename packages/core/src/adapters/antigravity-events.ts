import type { Usage } from "../types.js";

export const ANTIGRAVITY_STEP_USER_INPUT = 14;
export const ANTIGRAVITY_STEP_PLANNER_RESPONSE = 15;

export const ANTIGRAVITY_STATUS_DONE = 3;
export const ANTIGRAVITY_STATUS_ERROR = 7;
export const ANTIGRAVITY_STATUS_CANCELED = 6;

export const ANTIGRAVITY_IGNORED_STEP_TYPES = new Set([
  23, // CHECKPOINT
  90, // EPHEMERAL_MESSAGE
  98, // CONVERSATION_HISTORY
  101, // SYSTEM_MESSAGE
]);

export const ANTIGRAVITY_JSONL_IGNORED_TYPES = new Set([
  "CHECKPOINT",
  "CONVERSATION_HISTORY",
  "SYSTEM_MESSAGE",
  "GENERIC",
  "EPHEMERAL_MESSAGE",
]);

export const ANTIGRAVITY_JSONL_USER_TYPES = new Set(["USER_INPUT"]);
export const ANTIGRAVITY_JSONL_ASSISTANT_TYPES = new Set(["PLANNER_RESPONSE"]);
export const ANTIGRAVITY_JSONL_TOOL_RESULT_TYPES = new Set([
  "RUN_COMMAND",
  "VIEW_FILE",
  "LIST_DIRECTORY",
  "GREP_SEARCH",
  "SEARCH_WEB",
  "CODE_ACTION",
  "MCP_TOOL",
]);

export const ANTIGRAVITY_PAYLOAD_FIELD: Record<number, number> = {
  5: 10, // CODE_ACTION
  7: 13, // GREP_SEARCH
  8: 14, // VIEW_FILE
  9: 15, // LIST_DIRECTORY
  14: 19, // USER_INPUT
  15: 20, // PLANNER_RESPONSE
  17: 24,
  21: 28, // RUN_COMMAND
  23: 30, // CHECKPOINT
  38: 47, // MCP_TOOL
  90: 103,
  98: 111,
  101: 114,
  103: 116, // current VIEW_FILE result
  132: 140, // GENERIC
};

export function antigravityStepName(stepType: number): string {
  switch (stepType) {
    case 5:
      return "CODE_ACTION";
    case 7:
      return "GREP_SEARCH";
    case 8:
    case 103:
      return "VIEW_FILE";
    case 9:
      return "LIST_DIRECTORY";
    case 14:
      return "USER_INPUT";
    case 15:
      return "PLANNER_RESPONSE";
    case 21:
      return "RUN_COMMAND";
    case 23:
      return "CHECKPOINT";
    case 38:
      return "MCP_TOOL";
    case 90:
      return "EPHEMERAL_MESSAGE";
    case 98:
      return "CONVERSATION_HISTORY";
    case 101:
      return "SYSTEM_MESSAGE";
    case 132:
      return "GENERIC";
    default:
      return `step_${stepType}`;
  }
}

export interface AntigravityToolCall {
  id: string;
  name: string;
  input?: unknown;
}

export type AntigravityEvent =
  | {
      kind: "user";
      line: number;
      text: string;
      timestamp?: string;
      modelHint?: string;
    }
  | {
      kind: "assistant";
      line: number;
      text?: string;
      thinking?: string;
      timestamp?: string;
      usage?: Usage;
      toolCalls: AntigravityToolCall[];
    }
  | {
      kind: "tool_result";
      line: number;
      toolUseId?: string;
      output: unknown;
      status: "success" | "error";
      timestamp?: string;
    }
  | { kind: "ignored"; line: number; type: string }
  | { kind: "unknown"; line: number; type: string }
  | { kind: "malformed"; line: number; message: string };

const ENVELOPE_BLOCKS = [
  /<runtime_info>[\s\S]*?<\/runtime_info>/gi,
  /<pull_request_linking>[\s\S]*?<\/pull_request_linking>/gi,
  /<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi,
  /<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi,
];

export function unwrapAntigravityUserText(raw: string): string {
  const request = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  let text = request?.[1] ?? raw;
  for (const pattern of ENVELOPE_BLOCKS) {
    text = text.replace(pattern, "");
  }
  return text.replace(/\s+/g, " ").trim();
}

export function modelFromAntigravityText(text: string): string | undefined {
  const runtime = text.match(/\bas\s+((?:gemini|gpt|claude)[\w.-]*[a-z0-9])/i);
  if (runtime?.[1]) return runtime[1].toLowerCase();
  const settings = text.match(
    /Model Selection[^A-Za-z0-9]*([A-Za-z0-9._-]*gemini[A-Za-z0-9._-]*[A-Za-z0-9])/i,
  );
  if (settings?.[1]) return settings[1];
  const named = text.match(/\b(gemini-[\w.-]*[a-z0-9])\b/i);
  return named?.[1]?.toLowerCase();
}

export function modelFromProtobufStrings(texts: string[]): string | undefined {
  for (const text of texts) {
    const match = text.match(/\b(gemini-[\w.-]*[a-z0-9])\b/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return undefined;
}
