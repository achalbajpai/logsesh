export function escapeCsvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function neutralizeMarkdown(text: string, unsafeRaw = false): string {
  if (unsafeRaw) return text;
  let result = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  result = result.replace(/\[([^\]]+)\]\(\s*javascript:[^)]+\)/gi, "[$1](#)");
  result = result.replace(/\[([^\]]+)\]\(\s*data:[^)]+\)/gi, "[$1](#)");
  return result;
}

export async function writeExportFile(
  path: string,
  content: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  try {
    await writeFile(path, content, {
      mode: 0o600,
      encoding: "utf8",
      flag: opts.force ? "w" : "wx",
    });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : "";
    if (!opts.force && code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing file: ${path}. Use --force to overwrite.`);
    }
    throw err;
  }
}
