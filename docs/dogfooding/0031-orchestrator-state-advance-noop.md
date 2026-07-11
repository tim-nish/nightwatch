# Dogfooding finding 0031 — Following the documented run order, the state-advancing orchestrate call always noops: cadence cursors are never written and weekly cadence never takes effect

- **Date:** 2026-07-11
- **Session:** dogfooding against `~/work/product-lab`; fresh install, first full night
  executed exactly per `commands/nightwatch.md`.
- **Command:** `/nightwatch` overnight flow, step 6 (state update).
- **Classification:** **bug** — an ordering contradiction between the command doc and the
  idempotency gate. Silent: the run reports success and the brief is fine; only the
  scheduling memory is missing.
- **Status:** accepted 2026-07-11 — **Amendment N2** from the
  [0026–0034 triage record](../specs/DRAFT-findings-0026-0034-triage.md) is applied to
  `nightwatch.md` §6 (the state advance gates on `state.last_brief_date` only, never the
  dated brief file); bug-fix story pending, with the fresh-repo end-to-end regression.
- **Priority:** High.

## Observed behavior

`commands/nightwatch.md` orders the night: run members (step 3) → **assemble the brief
via `collect-brief.js` (step 4)** → backfill (step 5) → **advance cursors via
`orchestrate.js --repo .` without `--plan` (step 6)**, described as "the only step that
writes `state.json`."

But the idempotency gate runs *before* the write path and treats the dated brief on disk
as proof the night already completed:

- `alreadyRanTonight()` (`scripts/lib/schedule.js:177-180`) returns true if
  `state.last_brief_date === date` **or `briefs/<date>.md` exists**;
- `orchestrate.js:100-104` returns `{status:"noop", reason:"already-ran-tonight"}` on
  that gate, skipping the cursor write at `orchestrate.js:122-130` entirely.

By step 6 the brief (written in step 4) always exists, so the first state-advancing call
returned `noop` and `.nightwatch/runtime/cursors.json` was **never created**. Verified on
a fresh repo: after a complete documented night, no cursors file and no
`last_brief_date` existed anywhere; only `--force` (which the doc never instructs for
step 6) persisted them.

## Consequences

- **Weekly cadence never engages.** With no cursors, every plan reconciles from
  `defaultState()` (all cursors never-run → due immediately): `arch-review` runs every
  night instead of weekly, silently tripling the nightly budget ceiling.
- Same-night idempotency still works (via the brief file), which is exactly why the bug
  is invisible — nothing errors, `noop` even *looks* like the documented "subsequent
  same-night invocation returns noop" behavior.
- The older writing-assistant install has a populated legacy `state.json`, which suggests
  earlier runs advanced state *before* brief assembly (or predate the gate's
  brief-file clause) — i.e. executor behavior, not the documented order, is what has
  been keeping cadence alive.

## Suggested improvements

1. **Make the step-6 call immune to its own night:** the state-advance invocation should
   bypass the brief-file clause (e.g. an explicit `--record` mode, or gate only on
   `state.last_brief_date`, which is still null at step 6).
2. Or **reorder the doc**: advance cursors before `collect-brief.js` (the members are
   already done; the brief is presentation).
3. **Regression-test the documented sequence end-to-end** on a fresh repo: plan → members
   → collect-brief → orchestrate, then assert `runtime/cursors.json` exists and
   `arch-review.next_due` is 7 days out. The unit-level pieces all pass individually;
   only the composed order fails.
