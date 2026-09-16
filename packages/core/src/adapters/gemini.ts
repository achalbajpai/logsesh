import { ParseContext, scanSource } from "../parse-context.js";
import { SessionBuilder } from "../session-builder.js";
import type {
  Adapter,
  DiscoverOptions,
  ParseOptions,
  Session,
  SessionFile,
  ToolName,
} from "../types.js";
import { parseJsonLine, sessionFileNameId } from "../util.js";
import { detectRootAccess } from "../fs-walk.js";
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ADAPTER_VERSIONS, DEFAULT_LOG_ROOT_SEGMENTS } from "../constants.js";
import { classifyGeminiRecord } from "./gemini-schemas.js";
import { applyGeminiEvent, createGeminiState, geminiMessageToBlocks } from "./gemini-reducer.js";

function geminiRoot(opts: DiscoverOptions): string {
  return opts.roots?.gemini ?? join(homedir(), ...DEFAULT_LOG_ROOT_SEGMENTS.gemini);
}

export const geminiAdapter: Adapter = {
  tool: "gemini" as ToolName,
  adapterVersion: ADAPTER_VERSIONS.gemini,
  capabilities: {
    discovery: "full",
    transcript: "full",
    toolCalls: "full",
    usage: "partial",
    model: "partial",
    reasoning: "partial",
    notes: [
      "Leftover Gemini CLI JSONL ($set / $rewindTo). Current Google CLI sessions are Antigravity, not this layout.",
      "Legacy role/parts records are still recognized.",
    ],
  },

  async detect(): Promise<boolean> {
    const { accessible } = await detectRootAccess(geminiRoot({}), "gemini");
    return accessible;
  },

  async *discover(opts: DiscoverOptions): AsyncIterable<SessionFile> {
    const root = geminiRoot(opts);
    let projects: string[];
    try {
      projects = await readdir(root);
    } catch {
      return;
    }

    for (const project of projects) {
      const projectDir = join(root, project);
      try {
        const projectStat = await lstat(projectDir);
        if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) continue;
      } catch {
        continue;
      }

      const chatDir = join(projectDir, "chats");
      try {
        const s = await lstat(chatDir);
        if (s.isSymbolicLink() || !s.isDirectory()) continue;
      } catch {
        continue;
      }
      let files: string[];
      try {
        files = await readdir(chatDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.startsWith("session-") && file.endsWith(".jsonl")) {
          const path = join(chatDir, file);
          try {
            const fileStat = await lstat(path);
            if (fileStat.isSymbolicLink() || !fileStat.isFile()) continue;
          } catch {
            continue;
          }
          yield { path, tool: "gemini" };
        }
      }
    }
  },

  async *parse(file: SessionFile, opts: ParseOptions): AsyncIterable<Session> {
    const fallbackId = sessionFileNameId(file.path);
    const builder = new SessionBuilder({
      tool: "gemini",
      adapterVersion: ADAPTER_VERSIONS.gemini,
      sourcePath: file.path,
      sessionId: fallbackId,
      logFormatVersion: "gemini-cli-jsonl",
      maxTurnChars: opts.maxTurnChars,
      maxToolOutputChars: opts.maxToolOutputChars,
    });
    const ctx = new ParseContext({ tool: "gemini", sourcePath: file.path, sessionId: fallbackId });
    const state = createGeminiState();

    await scanSource(file.path, ctx, opts, (line, lineNumber) => {
      const parsed = parseJsonLine(line, lineNumber, file.path);
      if (!parsed.ok) {
        ctx.malformed(parsed.error, lineNumber);
        return;
      }
      const event = classifyGeminiRecord(parsed.value);
      const result = applyGeminiEvent(state, event, lineNumber);
      if (result === "recognized") ctx.recognized(event.kind);
      else if (result === "ignored") ctx.ignoredKnown(event.kind);
      else ctx.unknown(event.kind === "unknown" ? event.type : event.kind);
    });

    if (state.sessionId) {
      builder.setSessionId(state.sessionId);
      ctx.setSessionId(state.sessionId);
    }
    if (state.model) builder.setModel(state.model);
    if (state.kind === "subagent") {
      builder.setLineage({ agentType: "subagent" });
    }

    let step = 0;
    for (const message of state.messages) {
      step += 1;
      const mapped = geminiMessageToBlocks(message);
      if (mapped.blocks.length > 0) {
        builder.addRecord({
          role: mapped.role,
          fragmentGroupId: `${message.type}-${message.id}-${step}`,
          sourceLine: step,
          blocks: mapped.blocks,
          timestamp: message.timestamp ?? state.startTime,
          usage: mapped.usage,
        });
      }
      for (const result of mapped.toolResults) {
        builder.addToolResult({
          toolUseId: result.id,
          sourceLine: step,
          output: result.output,
          status: result.status,
        });
      }
      if (message.model) builder.setModel(message.model);
    }

    for (const warning of ctx.drainWarnings()) builder.addWarning(warning);
    builder.setFidelity(ctx.finalize());
    yield builder.finalize();
  },
};
