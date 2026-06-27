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
import { z } from "zod";

const ADAPTER_VERSION = "0.1.1-experimental";

const geminiLineSchema = z.object({
  role: z.string().optional(),
  timestamp: z.string().optional(),
  model: z.string().optional(),
  modelVersion: z.string().optional(),
  parts: z
    .array(
      z.union([
        z.object({ text: z.string().optional() }),
        z.object({
          functionCall: z
            .object({
              id: z.string().optional(),
              name: z.string().optional(),
              args: z.unknown().optional(),
            })
            .optional(),
        }),
        z.object({
          functionResponse: z
            .object({
              id: z.string().optional(),
              name: z.string().optional(),
              response: z.unknown().optional(),
            })
            .optional(),
        }),
      ]),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});

function geminiRoot(opts: DiscoverOptions): string {
  return opts.roots?.gemini ?? join(homedir(), ".gemini", "tmp");
}

export const geminiAdapter: Adapter = {
  tool: "gemini" as ToolName,
  adapterVersion: ADAPTER_VERSION,
  capabilities: {
    discovery: "experimental",
    transcript: "partial",
    toolCalls: "partial",
    usage: "partial",
    model: "partial",
    reasoning: "none",
    notes: [
      "Gemini CLI log format is experimental and may change.",
      "Usage metadata is captured when present; token totals may be incomplete.",
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
        const parsed = parseJsonLine(line, lineNumber, file.path);
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

        const lineParsed = geminiLineSchema.safeParse(parsed.value);
        if (!lineParsed.success) {
          builder.addWarning({
            code: "invalid_line_shape",
            message: `Line ${lineNumber}: invalid Gemini record shape`,
            severity: "warn",
            scope: "parse",
            sourcePath: file.path,
            sessionId,
            line: lineNumber,
          });
          return;
        }

        const record = lineParsed.data;
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
