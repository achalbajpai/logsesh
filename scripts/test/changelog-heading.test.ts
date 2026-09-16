import { describe, expect, it } from "vitest";
import {
  changelogHasUnreleasedHeading,
  changelogHasVersionHeading,
} from "../changelog-heading.mjs";

const staleUnreleased = `# Changelog

## [0.2.3] - Unreleased

### Added

- older work

## [0.2.2] - 2026-06-28
`;

const currentUnreleased = `# Changelog

## [0.3.0] - Unreleased

### Added

- current work

## [0.2.3] - Unreleased

## [0.2.2] - 2026-06-28
`;

describe("changelog headings", () => {
  it("rejects an older Unreleased section for a bumped package version", () => {
    expect(changelogHasVersionHeading(staleUnreleased, "0.3.0")).toBe(false);
    expect(changelogHasUnreleasedHeading(staleUnreleased, "0.3.0")).toBe(false);
    expect(changelogHasUnreleasedHeading(staleUnreleased, "0.2.3")).toBe(true);
    expect(changelogHasVersionHeading(staleUnreleased, "0.2.2")).toBe(true);
  });

  it("accepts ## [version] - Unreleased for the current version", () => {
    expect(changelogHasUnreleasedHeading(currentUnreleased, "0.3.0")).toBe(true);
    expect(changelogHasVersionHeading(currentUnreleased, "0.3.0")).toBe(true);
    expect(changelogHasUnreleasedHeading(currentUnreleased, "0.2.3")).toBe(true);
  });
});
