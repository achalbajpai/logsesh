import { ParseContext } from "../parse-context.js";
import type {
  Adapter,
  DiscoverOptions,
  ParseOptions,
  Session,
  SessionFile,
  ToolName,
} from "../types.js";
import { sessionFileNameId } from "../util.js";
import { detectRootAccess } from "../fs-walk.js";
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { ADAPTER_VERSIONS, DEFAULT_LOG_ROOT_SEGMENTS } from "../constants.js";

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
  return opts.roots?.gemini ?? join(homedir(), ...DEFAULT_LOG_ROOT_SEGMENTS.gemini);
}

export const geminiAdapter: Adapter = {
  tool: "gemini" as ToolName,
  adapterVersion: ADAPTER_VERSIONS.gemini,
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
    const ctx = new ParseContext({
      tool: "gemini",
      adapterVersion: ADAPTER_VERSIONS.gemini,
      file,
      opts,
      sessionId: sessionFileNameId(file.path),
      logFormatVersion: "experimental",
    });
    let stepCounter = 0;

    for await (const rec of ctx.records()) {
      const record = ctx.decode(rec, geminiLineSchema, "Gemini record");
      if (!record) continue;

      const model = record.model ?? record.modelVersion;
      if (model) ctx.setModel(model);

      const role = record.role;
      if (role !== "user" && role !== "model") continue;

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
          const id = fc.id ?? `call-${rec.seq}`;
          blocks.push({ kind: "tool_use", id, name: fc.name ?? "unknown", input: fc.args });
          stepCounter++;
        }
        if ("functionResponse" in part && part.functionResponse) {
          const fr = part.functionResponse;
          ctx.addToolResult({
            toolUseId: fr.id ?? `call-${rec.seq}`,
            sourceLine: rec.seq,
            output: fr.response,
            status: "success",
          });
        }
      }

      if (blocks.length > 0) {
        stepCounter++;
        ctx.addRecord({
          role: role === "model" ? "assistant" : "user",
          fragmentGroupId: `${role}-${stepCounter}`,
          sourceLine: rec.seq,
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
    }

    yield ctx.finish();
  },
};
