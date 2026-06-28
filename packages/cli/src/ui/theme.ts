import type { ToolName } from "@logsesh/core";
import pc from "picocolors";
import type { RenderMode } from "./mode.js";

export type Theme = ReturnType<typeof createTheme>;

const TOOL_COLOR: Record<ToolName, (text: string) => string> = {
  "claude-code": pc.magenta,
  codex: pc.blue,
  gemini: pc.green,
};

function paint(mode: RenderMode, fn: (text: string) => string): (text: string) => string {
  return (text: string) => (mode.color ? fn(text) : text);
}

export function createTheme(mode: RenderMode) {
  return {
    accent: paint(mode, pc.yellow),
    dim: paint(mode, pc.dim),
    label: paint(mode, pc.dim),
    value: (text: string) => text,
    ok: paint(mode, pc.green),
    warn: paint(mode, pc.yellow),
    err: paint(mode, pc.red),
    muted: paint(mode, pc.dim),
    tool: (tool: ToolName, text: string) => (mode.color ? TOOL_COLOR[tool](text) : text),
  };
}
