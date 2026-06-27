import { closeSync, openSync, readSync } from "node:fs";
import { z } from "zod";
import type { ToolName } from "./types.js";

const CODEX_TYPES = new Set(["session_meta", "response_item", "event_msg", "token_count"]);
const CLAUDE_TYPES = new Set(["user", "assistant", "system", "summary"]);
const SNIFF_HEAD_BYTES = 8192;

const sniffObjectSchema = z.record(z.string(), z.unknown());

export function inferToolFromPath(filePath: string): ToolName | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;

  if (
    normalized.includes("/.codex/sessions/") ||
    (base.startsWith("rollout-") && base.endsWith(".jsonl"))
  ) {
    return "codex";
  }
  if (
    normalized.includes("/.gemini/") &&
    normalized.includes("/chats/") &&
    base.startsWith("session-")
  ) {
    return "gemini";
  }
  if (normalized.includes("/.claude/projects/")) {
    return "claude-code";
  }
  return undefined;
}

export function sniffToolFromLogLine(line: string): ToolName | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    const result = sniffObjectSchema.safeParse(parsed);
    if (!result.success) return undefined;
    const obj = result.data;
    if ("payload" in obj && typeof obj.type === "string") {
      if (CODEX_TYPES.has(obj.type)) return "codex";
    }
    if ("message" in obj && typeof obj.type === "string") {
      if (CLAUDE_TYPES.has(obj.type)) return "claude-code";
    }
    if ("parts" in obj && typeof obj.role === "string") {
      return "gemini";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readFileHead(filePath: string, maxBytes: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function sniffToolFromFileHead(filePath: string): ToolName | undefined {
  const head = readFileHead(filePath, SNIFF_HEAD_BYTES);
  if (!head) return undefined;
  const firstLine = head.split("\n").find((line) => line.trim());
  return firstLine ? sniffToolFromLogLine(firstLine) : undefined;
}

export function resolveDebugTool(
  filePath: string,
  explicit?: ToolName,
): { tool: ToolName; warnings: string[] } {
  const warnings: string[] = [];
  const inferred = inferToolFromPath(filePath) ?? sniffToolFromFileHead(filePath);

  if (explicit) {
    if (inferred && inferred !== explicit) {
      warnings.push(
        `--tool ${explicit} does not match file format (expected ${inferred}); output may be wrong`,
      );
    }
    return { tool: explicit, warnings };
  }

  if (inferred) return { tool: inferred, warnings };

  warnings.push("could not infer tool from path or file format; defaulting to claude-code");
  return { tool: "claude-code", warnings };
}
