# Spec: Release-progress display — show the completed/total ratio alongside the percentage

- **Status:** proposed 2026-07-10 — **for review only.** Not folded into `nightwatch.md`; no FRs
  assigned. Refines the release-progress presentation of `nightwatch.md` §5 (the `RELEASE.md` status
  line and the morning brief's release-progress line). Captures the intended behavior for later
  triage.
- **Note 2026-07-10:** the ratio requirement (P1) is carried forward by
  [brief-composition](brief-composition.md) P6 — the brief's release surface is now the
  `## Where you stand` block, which renders the same `doneCount`/`total` ratio; the exact
  single-line brief format shown below is superseded by that composition. The `RELEASE.md`
  status-line rendering (P1) and all invariants stand as written.
- **Motivated by:** dogfooding finding
  [0014 — Release progress lacks the underlying ratio](../dogfooding/0014-release-progress-ratio.md);
  related to [0010 — progress percent formatting](../dogfooding/0010-progress-percent-formatting.md)
  (the fraction→percent contract this spec preserves).
- **Scope:** *presentation* of the release-progress number. No change to how progress is **computed**
  (`doneCount / total` over definition-of-done items + blockers), how it is **stored** (a 0–1
  fraction in `RELEASE.md` frontmatter), or to the tracker's single-writer rule.

## Problem

The release summary reports a bare percentage — e.g. **`67%`** — without the **ratio** it is derived
from (**`2/3`**). A percentage of a small criteria set is ambiguous: `67%` reads very differently as
`2/3` (one criterion left) than as `67/100` (a long way to go). The denominator and numerator are
**already computed** — `release-progress.js` derives `progress` as `doneCount / total` over the
tracked definition-of-done items plus blockers — but only the percentage reaches the display, so the
single most-read number in the brief is less legible than the data behind it.

## Design constraints (invariants this spec must not break)

1. **Representation contract preserved (finding 0010).** `progress:` stays a **0–1 fraction** in
   frontmatter; the percentage and the ratio are both rendered only at the **display boundary**. The
   ratio is derived from the same `doneCount`/`total`, never stored redundantly.
2. **Computed, never invented.** The ratio is exactly the counts the tracker already holds; the
   display adds no new judgment and no new scoping.
3. **Coarse and honest.** The ratio is the honest form of a coarse fraction — showing it must not
   imply more precision than "N of M criteria done."
4. **Deterministic.** Identical inputs render an identical line (the brief's byte-determinism
   guarantee holds).

## Proposal

### P1 — Show both the percentage and the completed/total ratio

Render the release-progress number as the percentage **and** the count it came from, in both
surfaces:

- `RELEASE.md` status line (`release-progress.js`):
  ```
  Release progress: 67% (2/3 criteria) toward "v0.1 public release" (+1 since last run).
  ```
- Morning brief release-progress line (`collect-brief.js`):
  ```
  - Progress: **67%** (2/3 criteria) toward v0.1 public release (phase: hardening)
  ```

- Numerator = completed tracked items (`doneCount`); denominator = total tracked items
  (definition-of-done items + blockers, excluding stale) — the same values `progress` is computed
  from.
- When the denominator is `0` (nothing tracked yet), show the existing "no criteria / generic"
  messaging rather than `0/0`.

### P2 — Optionally name what remains

For a small set, append the remaining count to make the next action explicit, e.g.
*"1 criterion remaining"* — derived from `total − doneCount`, no new computation.

## Non-goals

- No change to how progress is computed, stored, or which items are tracked.
- No second stored field — the ratio is derived at render time from `doneCount`/`total`.
- No precision beyond the coarse count (no weighting, no partial-credit criteria).

## Acceptance criteria

1. The `RELEASE.md` status line and the morning brief's release-progress line both show the
   percentage **and** the `completed/total` ratio (e.g. `67% (2/3 criteria)`) derived from the same
   counts `progress` is computed from.
2. `progress:` frontmatter remains a 0–1 fraction; the percentage and ratio are render-boundary only
   (finding 0010's contract intact).
3. A zero-denominator repo (nothing tracked) shows the existing generic messaging, never `0/0`.
4. Identical inputs render a byte-identical line.

## Tests

- **ratio render:** a fixture with 2 of 3 tracked criteria done → both surfaces show `67% (2/3
  criteria)`; frontmatter `progress:` stays `0.67`.
- **zero denominator:** a repo with no tracked criteria → generic messaging, no `0/0`.
- **determinism:** identical inputs → byte-identical release-progress line.
