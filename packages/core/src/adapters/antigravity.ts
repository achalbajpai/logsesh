import { existsSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix as posixPath } from "node:path";
import { ADAPTER_VERSIONS, DEFAULT_LOG_ROOT_SEGMENTS } from "../constants.js";
import { detectRootAccess } from "../fs-walk.js";
import { ParseContext } from "../parse-context.js";
import { SessionBuilder } from "../session-builder.js";
import type {
  Adapter,
  DiscoverOptions,
  InputContentBlock,
  ParseOptions,
  Session,
  SessionFile,
} from "../types.js";
import { toPosixPath } from "../util.js";
import {
  type AntigravityEvent,
  modelFromAntigravityText,
  unwrapAntigravityUserText,
} from "./antigravity-events.js";
import { parseAntigravitySqlite } from "./antigravity-sqlite.js";
import { parseAntigravityTranscript } from "./antigravity-transcript.js";

export function defaultAntigravityHomes(): string[] {
  const home = homedir();
  return [
    join(home, ...DEFAULT_LOG_ROOT_SEGMENTS.antigravity),
    join(home, ".gemini", "antigravity-ide"),
    join(home, ".gemini", "antigravity"),
  ];
}

export function getAntigravityHomes(opts: DiscoverOptions = {}): string[] {
  if (opts.roots?.antigravity) return [opts.roots.antigravity];
  return defaultAntigravityHomes();
}

function storeLooksPopulated(dir: string): boolean {
  return (
    existsSync(join(dir, "conversations")) ||
    existsSync(join(dir, "brain")) ||
    existsSync(join(dir, "antigravity-acp"))
  );
}

export function resolveAntigravityRoot(opts: DiscoverOptions = {}): string {
  const homes = getAntigravityHomes(opts);
  const fallback = homes[0] ?? join(homedir(), ...DEFAULT_LOG_ROOT_SEGMENTS.antigravity);
  if (opts.roots?.antigravity) return fallback;
  for (const home of homes) {
    if (storeLooksPopulated(home)) return home;
  }
  for (const home of homes) {
    if (existsSync(home)) return home;
  }
  return fallback;
}

async function isRealDir(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return !stat.isSymbolicLink() && stat.isDirectory();
  } catch {
    return false;
  }
}

async function isRealFile(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return !stat.isSymbolicLink() && stat.isFile();
  } catch {
    return false;
  }
}

async function expandStoreRoots(home: string): Promise<string[]> {
  const roots: string[] = [];
  const seen = new Set<string>();

  const tryAdd = async (dir: string): Promise<boolean> => {
    if (!(await isRealDir(dir))) return false;
    const acp = join(dir, "antigravity-acp");
    if ((await isRealDir(join(acp, "conversations"))) || (await isRealDir(join(acp, "brain")))) {
      if (!seen.has(acp)) {
        seen.add(acp);
        roots.push(acp);
      }
      return true;
    }
    if (existsSync(join(dir, "conversations")) || existsSync(join(dir, "brain"))) {
      if (!seen.has(dir)) {
        seen.add(dir);
        roots.push(dir);
      }
      return true;
    }
    return false;
  };

  await tryAdd(home);
  if (await isRealDir(home)) {
    let children: string[] = [];
    try {
      children = await readdir(home);
    } catch {
      children = [];
    }
    for (const child of children) {
      await tryAdd(join(home, child));
    }
  }
  if (roots.length === 0) roots.push(home);
  return roots;
}

type SourceKind = "transcript-full" | "transcript" | "sqlite";

function sourceRank(kind: SourceKind): number {
  if (kind === "transcript-full") return 0;
  if (kind === "transcript") return 1;
  return 2;
}

export function antigravityConversationId(filePath: string): string {
  const posix = toPosixPath(filePath);
  const base = posixPath.basename(posix);
  if (base === "transcript.jsonl" || base === "transcript_full.jsonl") {
    const parts = posix.split("/");
    const brainAt = parts.lastIndexOf("brain");
    const id = brainAt >= 0 ? parts[brainAt + 1] : undefined;
    if (id) return id;
    const sysAt = parts.lastIndexOf(".system_generated");
    if (sysAt > 0) return parts[sysAt - 1] ?? base;
  }
  return base.replace(/\.(jsonl|db)$/i, "");
}

async function readProjectPath(filePath: string, id: string): Promise<string | undefined> {
  const candidates = [join(dirname(filePath), `${id}.meta`)];
  let dir = dirname(filePath);
  for (let i = 0; i < 6; i += 1) {
    candidates.push(join(dir, "conversations", `${id}.meta`));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const candidate of candidates) {
    try {
      const raw: unknown = JSON.parse(await readFile(candidate, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      if ("cwd" in raw && typeof raw.cwd === "string" && raw.cwd.length > 0) return raw.cwd;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function collectTranscripts(
  root: string,
  keep: (id: string, path: string, kind: SourceKind) => void,
): Promise<void> {
  if (!(await isRealDir(root))) return;
  let ids: string[] = [];
  try {
    ids = await readdir(root);
  } catch {
    return;
  }
  for (const id of ids) {
    const logs = join(root, id, ".system_generated", "logs");
    const full = join(logs, "transcript_full.jsonl");
    const truncated = join(logs, "transcript.jsonl");
    if (await isRealFile(full)) keep(id, full, "transcript-full");
    else if (await isRealFile(truncated)) keep(id, truncated, "transcript");
  }
}

async function collectFiles(
  storeRoot: string,
): Promise<Map<string, { path: string; kind: SourceKind }>> {
  const found = new Map<string, { path: string; kind: SourceKind }>();
  const keep = (id: string, path: string, kind: SourceKind) => {
    const existing = found.get(id);
    if (!existing || sourceRank(kind) < sourceRank(existing.kind)) {
      found.set(id, { path, kind });
    }
  };

  const conversations = join(storeRoot, "conversations");
  if (await isRealDir(conversations)) {
    let names: string[] = [];
    try {
      names = await readdir(conversations);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith(".db")) continue;
      const path = join(conversations, name);
      if (await isRealFile(path)) keep(name.replace(/\.db$/i, ""), path, "sqlite");
    }
  } else if (await isRealDir(storeRoot)) {
    let names: string[] = [];
    try {
      names = await readdir(storeRoot);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith(".db")) continue;
      const path = join(storeRoot, name);
      if (await isRealFile(path)) keep(name.replace(/\.db$/i, ""), path, "sqlite");
    }
  }

  await collectTranscripts(join(storeRoot, "brain"), keep);
  await collectTranscripts(storeRoot, keep);
  return found;
}

function applyEvents(builder: SessionBuilder, events: AntigravityEvent[]): void {
  const pendingIds: string[] = [];
  for (const event of events) {
    if (event.kind === "malformed" || event.kind === "ignored" || event.kind === "unknown")
      continue;
    if (event.kind === "user") {
      const hint = event.modelHint ?? modelFromAntigravityText(event.text);
      if (hint) builder.setModel(hint);
      builder.addRecord({
        role: "user",
        sourceLine: event.line,
        timestamp: event.timestamp,
        blocks: [{ kind: "text", text: unwrapAntigravityUserText(event.text) }],
      });
      continue;
    }
    if (event.kind === "assistant") {
      const blocks: InputContentBlock[] = [];
      if (event.thinking) blocks.push({ kind: "thinking", text: event.thinking });
      if (event.text) blocks.push({ kind: "text", text: event.text });
      for (const call of event.toolCalls) {
        pendingIds.push(call.id);
        blocks.push({ kind: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      if (event.usage) builder.observeUsage({ mode: "delta", usage: event.usage });
      if (blocks.length === 0) continue;
      builder.addRecord({
        role: "assistant",
        sourceLine: event.line,
        timestamp: event.timestamp,
        blocks,
        usage: event.usage,
      });
      continue;
    }
    const toolUseId = event.toolUseId ?? pendingIds.shift();
    if (!toolUseId) continue;
    builder.addToolResult({
      toolUseId,
      sourceLine: event.line,
      output: event.output,
      status: event.status,
    });
  }
}

function recordSqliteEvents(ctx: ParseContext, events: AntigravityEvent[]): void {
  for (const event of events) {
    ctx.observeRecord(1);
    ctx.addBytesParsed(1);
    if (event.kind === "ignored") ctx.ignoredKnown(event.type);
    else if (event.kind === "unknown") ctx.unknown(event.type);
    else if (event.kind === "malformed") ctx.malformed(event.message, event.line);
    else ctx.recognized(event.kind);
  }
}

export const antigravityAdapter: Adapter = {
  tool: "antigravity",
  adapterVersion: ADAPTER_VERSIONS.antigravity,
  capabilities: {
    discovery: "full",
    transcript: "full",
    toolCalls: "full",
    usage: "partial",
    model: "partial",
    reasoning: "partial",
    notes: [
      "Antigravity CLI (agy) and Antigravity ACP store conversations as SQLite protobuf plus optional transcript JSONL.",
      "Uses transcript_full.jsonl when present, otherwise the conversation database.",
      "Default homes: ~/.gemini/antigravity-cli, ~/.gemini/antigravity-ide, ~/.gemini/antigravity.",
    ],
  },

  async detect(): Promise<boolean> {
    for (const home of getAntigravityHomes()) {
      const { accessible } = await detectRootAccess(home, "antigravity");
      if (accessible) return true;
    }
    return false;
  },

  async *discover(opts: DiscoverOptions): AsyncIterable<SessionFile> {
    for (const home of getAntigravityHomes(opts)) {
      for (const store of await expandStoreRoots(home)) {
        const files = await collectFiles(store);
        for (const file of files.values()) {
          yield { path: file.path, tool: "antigravity" };
        }
      }
    }
  },

  async *parse(file: SessionFile, opts: ParseOptions): AsyncIterable<Session> {
    const id = antigravityConversationId(file.path);
    const isSqlite = file.path.toLowerCase().endsWith(".db");
    const builder = new SessionBuilder({
      tool: "antigravity",
      adapterVersion: ADAPTER_VERSIONS.antigravity,
      sourcePath: file.path,
      sessionId: id,
      logFormatVersion: isSqlite ? "antigravity-sqlite-protobuf" : "antigravity-transcript-jsonl",
      maxTurnChars: opts.maxTurnChars,
      maxToolOutputChars: opts.maxToolOutputChars,
    });
    const ctx = new ParseContext({ tool: "antigravity", sourcePath: file.path, sessionId: id });
    builder.setProjectPath(await readProjectPath(file.path, id));

    if (isSqlite) {
      const parsed = await parseAntigravitySqlite(file.path, { maxFileBytes: opts.maxFileBytes });
      if (parsed.skipped) {
        ctx.markMetadataOnly(`File exceeds max size (${parsed.size} bytes), skipped`);
        ctx.addWarning({
          code: "file_too_large",
          message: `File exceeds max size (${parsed.size} bytes), skipped`,
          severity: "warn",
        });
      } else {
        if (parsed.error) {
          ctx.malformed(parsed.error);
          ctx.markPartial("sqlite parse failed");
        }
        if (parsed.model) builder.setModel(parsed.model);
        recordSqliteEvents(ctx, parsed.events);
        applyEvents(builder, parsed.events);
      }
    } else {
      const parsed = await parseAntigravityTranscript(file.path, ctx, opts);
      if (parsed.truncated) ctx.markPartial("truncated transcript fields");
      applyEvents(builder, parsed.events);
    }

    for (const warning of ctx.drainWarnings()) builder.addWarning(warning);
    builder.setFidelity(ctx.finalize());
    yield builder.finalize();
  },
};
