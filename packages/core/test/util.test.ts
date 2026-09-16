import { describe, expect, it } from "vitest";
import { sessionFileNameId } from "../src/util.js";

describe("sessionFileNameId", () => {
  it("uses the posix basename", () => {
    expect(sessionFileNameId("/tmp/foo/bar.jsonl")).toBe("bar");
  });

  it("uses the Windows basename", () => {
    expect(sessionFileNameId("C:\\foo\\bar.jsonl")).toBe("bar");
  });
});
