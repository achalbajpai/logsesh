import { SessionBuilder } from "../session-builder.js";
import type {
  Adapter,
  DiscoverOptions,
  ParseOptions,
  Session,
  SessionFile,
  ToolName,
} from "../types.js";
import { parseJsonLine, readJsonlLines, sessionFileNameId } from "../util.js";
import { detectRootAccess } from "../fs-walk.js";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const ADAPTER_VERSION = "0.1.0-experimental";

interface GeminiLine {
  role?: string;
  timestamp?: string;
  model?: string;
  modelVersion?: string;
  parts?: Array<
    | { text?: string }
    | { functionCall?: { id?: string; name?: string; args?: unknown } }
    | { functionResponse?: { id?: string; name?: string; response?: unknown } }
  >;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function geminiRoot(opts: DiscoverOptions): string {
  return opts.roots?.gemini ?? join(homedir(), ".gemini", "tmp");
}

export const geminiAdapter: Adapter = {
  tool: "gemini" as ToolName,
  adapterVersion: ADAPTER_VERSION,

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
      const chatDir = join(root, project, "chats");
      try {
        const s = await stat(chatDir);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }
      const files = await readdir(chatDir);
      for (const file of files) {
        if (file.startsWith("session-") && file.endsWith(".jsonl")) {
          yield { path: join(chatDir, file), tool: "gemini" };
        }
      }
    }
  },

  async *parse(file: SessionFile, opts: ParseOptions): AsyncIterable<Session> {
    const sessionId = sessionFileNameId(file.path);
    let stepCounter = 0;
    let model: string | undefined;

    const builder = new SessionBuilder({
      tool: "gemini",
      adapterVersion: ADAPTER_VERSION,
      sourcePath: file.path,
      sessionId,
      logFormatVersion: "experimental",
      maxTurnChars: opts.maxTurnChars,
      maxToolOutputChars: opts.maxToolOutputChars,
    });

    const readResult = await readJsonlLines(
      file.path,
      (line, lineNumber) => {
        const parsed = parseJsonLine<GeminiLine>(line, lineNumber, file.path);
        if (!parsed.ok) {
          builder.addWarning({
            code: "malformed_line",
            message: parsed.error,
            severity: "warn",
            scope: "parse",
            sourcePath: file.path,
            sessionId,
            line: lineNumber,
          });
          return;
        }

        const record = parsed.value;
        model = record.model ?? record.modelVersion ?? model;
        const role = record.role;
        if (role !== "user" && role !== "model") return;

        const blocks: Array<
          | { kind: "text"; text: string }
          | { kind: "tool_use"; id: string; name: string; input?: unknown }
        > = [];

        for (const part of record.parts ?? []) {
          if ("text" in part && part.text) {
            blocks.push({ kind: "text", text: part.text });
          }
          if ("functionCall" in part && part.functionCall) {
            const fc = part.functionCall;
            const id = fc.id ?? `call-${lineNumber}`;
            blocks.push({ kind: "tool_use", id, name: fc.name ?? "unknown", input: fc.args });
            stepCounter++;
          }
          if ("functionResponse" in part && part.functionResponse) {
            const fr = part.functionResponse;
            builder.addToolResult({
              toolUseId: fr.id ?? `call-${lineNumber}`,
              sourceLine: lineNumber,
              output: fr.response,
              status: "success",
            });
          }
        }

        if (blocks.length > 0) {
          stepCounter++;
          builder.addRecord({
            role: role === "model" ? "assistant" : "user",
            fragmentGroupId: `${role}-${stepCounter}`,
            sourceLine: lineNumber,
            blocks,
            timestamp: record.timestamp,
            usage: record.usageMetadata
              ? {
                  inputTokens: record.usageMetadata.promptTokenCount,
                  outputTokens: record.usageMetadata.candidatesTokenCount,
                  totalTokens: record.usageMetadata.totalTokenCount,
                }
              : undefined,
          });
        }
      },
      { maxFileBytes: opts.maxFileBytes },
    );

    if (readResult.skipped) {
      builder.addWarning({
        code: "file_too_large",
        message: `File exceeds max size (${readResult.size} bytes), skipped`,
        severity: "warn",
        scope: "parse",
        sourcePath: file.path,
        sessionId,
      });
    }

    const session = builder.finalize();
    session.model = model;
    yield session;
  },
};
