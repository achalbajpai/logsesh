import type { WriteStream } from "node:tty";

export type RenderMode = {
  mode: "rich" | "plain";
  color: boolean;
  unicode: boolean;
};

export interface RenderOptions {
  plain?: boolean;
  color?: boolean;
  noColor?: boolean;
}

export function hasColorFlagConflict(argv: string[] = process.argv): boolean {
  return argv.includes("--color") && argv.includes("--no-color");
}

export function validateRenderOptions(opts: RenderOptions): string | null {
  if (hasColorFlagConflict()) {
    return "Cannot use --color and --no-color together";
  }
  if (opts.color && opts.noColor) {
    return "Cannot use --color and --no-color together";
  }
  return null;
}

function resolveOutputMode(opts: RenderOptions, stream: WriteStream): "rich" | "plain" {
  if (opts.plain || process.env.LOGSESH_PLAIN === "1") {
    return "plain";
  }
  if (!stream.isTTY) {
    return "plain";
  }
  return "rich";
}

function resolveColor(opts: RenderOptions, stream: WriteStream): boolean {
  if (opts.noColor || opts.color === false) {
    return false;
  }
  if (opts.color === true) {
    return true;
  }
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined) {
    return true;
  }
  return stream.isTTY === true;
}

export function resolveRenderMode(
  opts: RenderOptions,
  stream: WriteStream = process.stdout,
): RenderMode {
  const mode = resolveOutputMode(opts, stream);
  return {
    mode,
    color: mode === "rich" ? resolveColor(opts, stream) : false,
    unicode: mode === "rich",
  };
}
