# Dogfooding finding 0004 — Morning feedback requires manual Markdown editing

- **Date:** 2026-07-10
- **Artifact:** the morning feedback loop (`.nightwatch/MORNING.md` checkboxes →
  `scripts/backfill-feedback.js` → `recordFeedback()` → ledger → demotion rule)
- **Classification:** UX issue — the loop works as specified; the input method is the
  friction point.
- **Status:** documented; proposed improvement specced in
  [`docs/specs/interactive-morning-review.md`](../specs/interactive-morning-review.md).
  No changes implemented.

## Observed behavior

To close the feedback loop, the user must open `.nightwatch/MORNING.md` in an editor and
hand-edit each finding's checkbox: `[x]` for acted-on, `[-]` (or `[~]`) for dismissed. The
next run's `backfill-feedback.js` reads those marks and records them to the ledger via
`recordFeedback()`. There is no way to provide this feedback from within Claude Code, where
the user is already working — reviewing the brief means switching to a text editor and
knowing an unstated mark syntax.

## Why this is a problem

- **The whole system depends on this input, and it's the most manual step in the design.**
  Ranking quality, ledger memory, and especially the demotion rule ("a member with zero
  acted-on findings two runs running is flagged for retirement") all consume these marks. If
  marking is tedious, users skip it — and unmarked findings are indistinguishable from
  ignored ones, so the demotion rule fires on jobs whose findings were acted on but never
  recorded. The system's self-pruning mechanism starves on friction, not on signal.
- **The syntax is undiscoverable.** Nothing in the brief itself explains that `[x]` means
  acted-on and `[-]` means dismissed, or that the marks are read exactly once by the next
  run. A user who writes notes instead of marks, or marks after the next run already
  backfilled, silently loses their feedback.
- **It breaks the medium.** The user reads the brief in Claude Code (or has Claude summarize
  it), but must leave that context to respond to it. Every other Nightwatch interaction —
  init, the run itself — happens as a conversation; the one daily human touchpoint is a raw
  file edit.

## Risks

- Feedback simply not given → ledger records no acted-on marks → healthy jobs demoted and
  flagged for retirement.
- Malformed or late marks silently dropped → user believes they responded; system disagrees.
- The morning brief becomes read-only in practice, degrading Nightwatch from a feedback loop
  to a report generator.

## Suggested improvement (summarized; full spec in `docs/specs/interactive-morning-review.md`)

An interactive review mode inside Claude Code — e.g. `/nightwatch:review` — that walks the
current brief's findings one at a time and offers a choice per finding:

- **Acted on** — recorded as acted-on
- **Dismiss** — recorded as dismissed
- **Skip for now** — no record; the finding stays unmarked and can be revisited

Nightwatch then updates the ledger automatically through `recordFeedback()` (the sole
sanctioned ledger writer) and keeps `MORNING.md`'s checkboxes in sync, so the existing
file-based flow and the new interactive flow never disagree. Manual checkbox editing remains
supported as the durable fallback.
