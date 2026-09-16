import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { toPosixPath } from "@logsesh/core";

export async function sourceFingerprint(filePath: string): Promise<{
  size: number;
  mtimeMs: number;
  fingerprint: string;
}> {
  const fileStat = await stat(filePath);
  const handle = await open(filePath, "r");
  try {
    const length = Math.min(4096, Number(fileStat.size));
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    const hash = createHash("sha256").update(buf.subarray(0, bytesRead)).digest("hex").slice(0, 16);
    return {
      size: Number(fileStat.size),
      mtimeMs: Math.trunc(fileStat.mtimeMs),
      fingerprint: `${fileStat.size}:${Math.trunc(fileStat.mtimeMs)}:${hash}`,
    };
  } finally {
    await handle.close();
  }
}

export function sessionKey(tool: string, sourcePath: string, sessionId: string): string {
  const pathHash = createHash("sha256").update(toPosixPath(sourcePath)).digest("hex").slice(0, 16);
  return `${tool}:${pathHash}:${sessionId}`;
}
