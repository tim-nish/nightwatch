# Dogfooding finding 0014 — Release-progress summary shows a percentage but not the completed/total ratio behind it

- **Date:** 2026-07-10
- **Session:** dogfooding — third run on the *writing-assistant* repository.
- **Command:** `/release-progress` → the `RELEASE.md` status line and the morning brief's
  release-progress line (`release-progress.js` / `collect-brief.js`).
- **Classification:** UX / presentation — the number is correct; it is missing the context that
  makes it legible. Not a bug.
- **Status:** documented; folded into
  [`docs/specs/release-progress-display.md`](../specs/release-progress-display.md). No code changes
  implemented.

## Observed behavior

The release summary reported **`67%`** but not the underlying **ratio** (e.g. **`2/3`**). The
percentage alone was harder to act on than the concrete count it was derived from.

## Why this matters

1. **The ratio is already computed.** `progress` is derived as `doneCount / total` over the tracked
   definition-of-done items plus blockers (`release-progress.js`) and stored as a 0–1 fraction. Both
   the numerator and denominator are known at render time — only the percentage is shown.
2. **A percentage of a small set is ambiguous.** `67%` reads very differently as `2/3` (one
   criterion left — nearly there) than as `67/100` (a long way to go). Showing the ratio makes the
   distance-to-release **immediately understandable and actionable** ("one criterion remaining").
3. **It fits the tool's "coarse, honest progress" framing.** The honest, legible form of a coarse
   fraction is the fraction itself. A bare percentage hides the coarseness that makes it honest.

## Risks

- Users over- or under-read the headline number without its denominator, mis-estimating how close a
  release actually is.
- The single most-read number in the brief (the release headline) is less informative than the data
  already behind it.

## Suggested improvements (folded into `docs/specs/release-progress-display.md`)

1. **Show both the percentage and the completed/total ratio**, e.g.
   *"Release progress: 67% (2/3 criteria)"* — in **both** `RELEASE.md`'s status line and the morning
   brief's release-progress line, from the same `doneCount`/`total` already computed.
2. **Preserve the fraction→percent representation contract** (finding
   [0010](0010-progress-percent-formatting.md)): the ratio is derived from the same values, rendered
   at the display boundary; the stored `progress:` frontmatter stays a 0–1 fraction.
3. **Optionally name what remains** for the small-set case (e.g. *"1 criterion remaining"*), so the
   next action is explicit.
