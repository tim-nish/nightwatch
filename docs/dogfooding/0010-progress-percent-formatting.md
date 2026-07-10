# Dogfooding finding 0010 — Morning brief renders progress as `0.38%` instead of `38%`

- **Date:** 2026-07-10
- **Session:** third dogfooding round.
- **Command:** `/nightwatch` overnight flow → the morning brief (`collect-brief.js`).
- **Classification:** implementation bug (display / representation) — the underlying value is
  correct; the percentage formatting is wrong, off by 100×.
- **Status:** documented; root cause and fix identified below. No changes implemented.

## Observed behavior

The morning brief's release-progress line — the **first, headline number** — displayed:

```
- Progress: **0.38%** toward v0.1 public release …
```

for a value that should read **`38%`**.

## Root cause

The `progress` representation is not pinned or normalized at the render boundary:

- `scripts/collect-brief.js:112` renders it verbatim:
  `` `- Progress: **${rel.fm.progress}%** …` `` — it reads `progress` straight from `RELEASE.md`
  frontmatter and appends `%` with **no normalization or validation**.
- `scripts/release-progress.js:318` computes progress as an **integer percent**
  (`Math.round((100 * doneCount) / tracked.length)`), and its own brief line
  (`release-progress.js:107`) likewise renders `${progress}%`.

So both renderers *assume* `progress` is already a `0–100` integer, but the value that reached the
brief was a **fraction (`0.38`)**, which renders as `0.38%`. The representation contract — **percent
(0–100)** vs **fraction (0–1)** — is neither documented nor enforced, and `collect-brief` trusts the
frontmatter blindly, so any fractional value (a hand edit, an older/alternate writer, or a future
tracking backend) prints 100× too small.

## Why this matters

- The release-progress delta is the **headline line** of the brief — the one number a user reads
  first. Showing `0.38%` for `38%` reads as "no progress at all," directly undermining the metric
  the whole `/release-progress` job exists to provide.
- The delta arithmetic (`release-progress.js:107`, `delta = progress − prevProgress`) is computed on
  whatever representation is in play, so a fraction/percent mix can compound into wrong deltas too.

## Risks

- Users misjudge release readiness on first contact (0.38% looks like a stalled project).
- Silent 100× errors are the worst kind — the number *looks* plausible, just tiny.

## Suggested improvements

1. **Pin one canonical representation** — integer percent `0–100` — and state it in `nightwatch.md`
   §5 (the `RELEASE.md` frontmatter contract) so writers and readers agree.
2. **Normalize at the single render boundary** in `collect-brief.js` (and defensively in the
   tracker's `updateHead`): if `progress` is a fraction in `(0, 1]`, render `Math.round(progress *
   100)`; otherwise render the integer as-is — so the brief shows `38%` regardless of which
   representation reaches it.
3. **Test:** assert the brief renders `38%` for both `progress: 38` and `progress: 0.38`, and that
   the delta is computed on the normalized value.
