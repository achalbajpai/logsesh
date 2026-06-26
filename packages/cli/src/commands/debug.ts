import type { ToolName } from "@logsesh/core";
import { debugEnvelopeSchema, generatedAt, parseFile, resolveDebugTool } from "@logsesh/core";

export interface DebugOptions {
  file: string;
  tool?: ToolName;
  json?: boolean;
  maxFileBytes?: number;
  maxTurnChars?: number;
  maxToolOutputChars?: number;
}

export async function runDebug(opts: DebugOptions): Promise<number> {
  const { tool, warnings } = resolveDebugTool(opts.file, opts.tool);
  for (const warning of warnings) {
    console.error(`Warning: ${warning}`);
  }

  const session = await parseFile(opts.file, tool, {
    maxFileBytes: opts.maxFileBytes,
    maxTurnChars: opts.maxTurnChars,
    maxToolOutputChars: opts.maxToolOutputChars,
  });
  if (!session) {
    console.error("Failed to parse file");
    return 2;
  }

  const hasReasoning = session.turns.some((t) => t.content.some((b) => b.kind === "thinking"));
  console.error("Warning: debug output may contain raw paths and reasoning.");
  if (hasReasoning) {
    console.error("Warning: session contains reasoning/thinking blocks.");
  }

  if (opts.json) {
    const envelope = {
      format: "logsesh.debug.v1" as const,
      generatedAt: generatedAt(),
      session,
      warnings: [],
    };
    debugEnvelopeSchema.parse(envelope);
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    console.log(JSON.stringify(session, null, 2));
  }

  return 0;
}
