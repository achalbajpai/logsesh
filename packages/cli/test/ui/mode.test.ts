import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRenderMode, validateRenderOptions } from "../../src/ui/mode.js";

function mockStream(isTTY: boolean, columns = 80): NodeJS.WriteStream {
  return { isTTY, columns } as NodeJS.WriteStream;
}

describe("validateRenderOptions", () => {
  it("rejects --color and --no-color together", () => {
    expect(validateRenderOptions({ color: true, noColor: true })).toBe(
      "Cannot use --color and --no-color together",
    );
  });

  it("accepts single color flags", () => {
    expect(validateRenderOptions({ color: true })).toBeNull();
    expect(validateRenderOptions({ noColor: true })).toBeNull();
  });
});

describe("resolveRenderMode", () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    delete process.env.LOGSESH_PLAIN;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("defaults to rich color+unicode on a TTY", () => {
    expect(resolveRenderMode({}, mockStream(true))).toEqual({
      mode: "rich",
      color: true,
      unicode: true,
    });
  });

  it("uses plain mode when stdout is not a TTY", () => {
    expect(resolveRenderMode({}, mockStream(false))).toEqual({
      mode: "plain",
      color: false,
      unicode: false,
    });
  });

  it("honors --plain on a TTY", () => {
    expect(resolveRenderMode({ plain: true }, mockStream(true))).toEqual({
      mode: "plain",
      color: false,
      unicode: false,
    });
  });

  it("honors LOGSESH_PLAIN=1 on a TTY", () => {
    process.env.LOGSESH_PLAIN = "1";
    expect(resolveRenderMode({}, mockStream(true))).toEqual({
      mode: "plain",
      color: false,
      unicode: false,
    });
  });

  it("ignores LOGSESH_PLAIN values other than 1", () => {
    process.env.LOGSESH_PLAIN = "true";
    expect(resolveRenderMode({}, mockStream(true)).mode).toBe("rich");
  });

  it("disables color with --no-color but keeps rich unicode", () => {
    expect(resolveRenderMode({ noColor: true }, mockStream(true))).toEqual({
      mode: "rich",
      color: false,
      unicode: true,
    });
  });

  it("disables color when commander reports --no-color as color:false", () => {
    expect(resolveRenderMode({ color: false }, mockStream(true))).toEqual({
      mode: "rich",
      color: false,
      unicode: true,
    });
  });

  it("disables color with NO_COLOR but keeps rich unicode", () => {
    process.env.NO_COLOR = "1";
    expect(resolveRenderMode({}, mockStream(true))).toEqual({
      mode: "rich",
      color: false,
      unicode: true,
    });
  });

  it("forces color with --color on a TTY", () => {
    expect(resolveRenderMode({ color: true }, mockStream(true)).color).toBe(true);
  });

  it("lets explicit --color override NO_COLOR", () => {
    process.env.NO_COLOR = "1";
    expect(resolveRenderMode({ color: true }, mockStream(true)).color).toBe(true);
  });

  it("forces color with FORCE_COLOR without changing plain mode when piped", () => {
    process.env.FORCE_COLOR = "1";
    expect(resolveRenderMode({}, mockStream(false))).toEqual({
      mode: "plain",
      color: false,
      unicode: false,
    });
  });

  it("does not let FORCE_COLOR override plain mode on a TTY", () => {
    process.env.FORCE_COLOR = "1";
    expect(resolveRenderMode({ plain: true }, mockStream(true))).toEqual({
      mode: "plain",
      color: false,
      unicode: false,
    });
  });
});
