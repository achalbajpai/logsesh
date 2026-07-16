import { afterEach, describe, expect, it, vi } from "vitest";
import { createScanProgress, shouldShowScanProgress } from "../../src/util/progress.js";
import { LOGSESH_PLAIN_ENV } from "../../src/constants.js";

describe("shouldShowScanProgress", () => {
  afterEach(() => {
    delete process.env[LOGSESH_PLAIN_ENV];
  });

  it("is false for json, plain, and LOGSESH_PLAIN", () => {
    expect(shouldShowScanProgress({ json: true })).toBe(false);
    expect(shouldShowScanProgress({ plain: true })).toBe(false);
    process.env[LOGSESH_PLAIN_ENV] = "1";
    expect(shouldShowScanProgress({})).toBe(false);
  });
});

describe("createScanProgress", () => {
  it("writes and clears when enabled", () => {
    const writes: string[] = [];
    const stream = {
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const progress = createScanProgress({ enabled: true, stream });
    progress.update(2);
    progress.done();
    expect(writes[0]).toContain("scanning… 2 files");
    expect(writes.at(-1)).toMatch(/^\r +\r$/);
  });

  it("is a no-op when disabled", () => {
    const write = vi.fn();
    const progress = createScanProgress({
      enabled: false,
      stream: { write } as unknown as NodeJS.WriteStream,
    });
    progress.update(1);
    progress.done();
    expect(write).not.toHaveBeenCalled();
  });
});
