import { describe, expect, it } from "vitest";
import {
  emptySearchHint,
  emptySearchMessage,
  emptySessionsHint,
  emptySessionsMessage,
  renderEmpty,
} from "../../src/ui/empty.js";

describe("renderEmpty", () => {
  it("returns message and optional hint", () => {
    expect(renderEmpty({ message: "0 matches (query=x)" })).toEqual(["0 matches (query=x)"]);
    expect(renderEmpty({ message: "0 matches (query=x)", hint: "try: logsesh doctor" })).toEqual([
      "0 matches (query=x)",
      "try: logsesh doctor",
    ]);
  });
});

describe("empty helpers", () => {
  it("builds session and search empty copy", () => {
    expect(emptySessionsMessage("tool=claude-code")).toBe("no sessions matched (tool=claude-code)");
    expect(emptySessionsHint("no filters")).toBe("try: logsesh doctor");
    expect(emptySessionsHint("query=x")).toBeUndefined();
    expect(emptySearchMessage("query=zzz")).toBe("0 matches (query=zzz)");
    expect(emptySearchHint()).toContain("project:myapp");
  });
});
