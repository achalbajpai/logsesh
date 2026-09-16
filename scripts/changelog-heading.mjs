export function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function changelogHasVersionHeading(changelog, version) {
  return new RegExp(`^## \\[${escapeRe(version)}\\]`, "m").test(changelog);
}

export function changelogHasUnreleasedHeading(changelog, version) {
  return new RegExp(`^## \\[${escapeRe(version)}\\] - Unreleased\\s*$`, "m").test(changelog);
}
