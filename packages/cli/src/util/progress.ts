import type { WriteStream } from "node:tty";
import { LOGSESH_PLAIN_ENV, LOGSESH_PLAIN_VALUE } from "../constants.js";

export interface ScanProgress {
  update(filesDiscovered: number): void;
  done(): void;
}

export function shouldShowScanProgress(opts: { json?: boolean; plain?: boolean }): boolean {
  if (opts.json || opts.plain) return false;
  if (process.env[LOGSESH_PLAIN_ENV] === LOGSESH_PLAIN_VALUE) return false;
  return process.stderr.isTTY === true;
}

export function createScanProgress(opts: { enabled: boolean; stream?: WriteStream }): ScanProgress {
  const stream = opts.stream ?? process.stderr;
  let last = 0;
  let written = false;

  return {
    update(filesDiscovered: number) {
      if (!opts.enabled) return;
      last = filesDiscovered;
      written = true;
      stream.write(`\rscanning… ${filesDiscovered} file${filesDiscovered === 1 ? "" : "s"}`);
    },
    done() {
      if (!opts.enabled || !written) return;
      const width = Math.max(24, `scanning… ${last} files`.length + 2);
      stream.write(`\r${" ".repeat(width)}\r`);
    },
  };
}
