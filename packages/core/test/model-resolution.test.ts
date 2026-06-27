import { describe, expect, it } from "vitest";
import {
  ClaudeModelTracker,
  CodexModelTracker,
  isPlaceholderModel,
} from "../src/model-resolution.js";

describe("model resolution", () => {
  it("treats synthetic Claude models as placeholders", () => {
    expect(isPlaceholderModel("<synthetic>")).toBe(true);
    expect(isPlaceholderModel("claude-opus-4-8")).toBe(false);
  });

  it("ClaudeModelTracker prefers billable model over later synthetic line", () => {
    const tracker = new ClaudeModelTracker();
    tracker.observe("claude-opus-4-8", 7000);
    tracker.observe("<synthetic>", 0);
    expect(tracker.resolve()).toBe("claude-opus-4-8");
  });

  it("CodexModelTracker ignores bare provider names", () => {
    const tracker = new CodexModelTracker();
    tracker.observe("openai");
    tracker.observe("gpt-5.5");
    expect(tracker.resolve()).toBe("gpt-5.5");
  });
});
