import { describe, expect, it } from "vitest";
import { escapeCsvCell, neutralizeMarkdown, writeExportFile } from "../src/export-safety.js";
import { parseRedactPatterns, redactText } from "../src/redact.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("export safety", () => {
  it("neutralizes csv formula injection", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("+cmd")).toBe("'+cmd");
  });

  it("escapes markdown html and javascript links", () => {
    const out = neutralizeMarkdown("<script>alert(1)</script> [x](javascript:alert(1))");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("javascript:");
  });
});

describe("redact", () => {
  it("redacts bearer tokens", () => {
    expect(redactText("Authorization: Bearer abc.def.ghi")).toContain("[REDACTED]");
  });

  it("redacts modern openai and github tokens", () => {
    expect(redactText("key=sk-proj-abcdefghijklmnopqrstuvwxyz123456")).toContain("[REDACTED]");
    expect(redactText("token github_pat_abcdefghijklmnopqrstuvwxyz1234567890")).toContain(
      "[REDACTED]",
    );
  });

  it("reports invalid custom patterns", () => {
    const { patterns, errors } = parseRedactPatterns(["(", "secret-[0-9]+"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Invalid redact pattern");
    expect(patterns).toHaveLength(1);
  });
});

describe("writeExportFile", () => {
  it("refuses to overwrite existing files without force", async () => {
    const dir = mkdtempSync(join(tmpdir(), "logsesh-export-"));
    const path = join(dir, "out.csv");
    writeFileSync(path, "existing");
    await expect(writeExportFile(path, "new", { force: false })).rejects.toThrow(
      "Refusing to overwrite",
    );
    expect(readFileSync(path, "utf8")).toBe("existing");
  });

  it("creates new files exclusively", async () => {
    const dir = mkdtempSync(join(tmpdir(), "logsesh-export-"));
    const path = join(dir, "new.csv");
    await writeExportFile(path, "fresh", { force: false });
    expect(readFileSync(path, "utf8")).toBe("fresh");
  });
});
