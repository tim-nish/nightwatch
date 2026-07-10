# Spec: Interactive morning review

- **Status:** accepted 2026-07-10 — folded into `nightwatch.md` §6 (`review` mode);
  FR44 in the epics requirements inventory. Strictly selection-based — acted-on /
  dismissed / skip are the entire input vocabulary. Implementation pending (Epic 6).
- **Refined 2026-07-10 by [brief-composition](brief-composition.md) P8:** review walks the
  brief's rendered *action lines* rather than raw findings — a bundled action is one
  question, recording one feedback row per covered id (same writer, same per-id
  idempotency). All constraints and criteria below are otherwise unchanged.
- **Motivated by:** dogfooding finding
  [0004 — Morning feedback requires manual Markdown editing](../dogfooding/0004-interactive-morning-review.md)
- **Scope:** a new interactive command surface for providing feedback on brief findings.
  The ledger format, `recordFeedback()` contract, backfill mechanism, and demotion rule are
  unchanged — this is a new front-end to the existing loop, not a new loop.

## Problem

The only way to tell Nightwatch what happened to a finding is to hand-edit checkbox marks in
`.nightwatch/MORNING.md` (`[x]` acted-on, `[-]`/`[~]` dismissed) and wait for the next run's
backfill. The syntax is undiscoverable, the editing is manual, and the feedback happens
outside Claude Code — so in practice feedback is skipped, which starves the ranking memory
and misfires the demotion rule.

## Design constraints

1. **One ledger writer.** All feedback lands through the tracking store's `recordFeedback()`
   — the same sanctioned path `backfill-feedback.js` uses. The interactive mode adds no
   second write path to `ledger.jsonl`.
2. **The file stays the source of truth.** `MORNING.md` checkboxes must remain a fully
   supported input (offline editing, other tooling, habit). The interactive mode and the
   file must never disagree after a session.
3. **Idempotent with backfill.** A finding recorded interactively must not be double-counted
   when the next run's backfill reads the same brief — the existing "skip marks already
   recorded" rule extends to interactive records.
4. **Daytime and interactive only.** This mode may ask questions; it never runs as part of
   the overnight flow.
5. **Respect morning attention.** Reviewing a full brief (≤ 25 findings) should take a
   couple of minutes; the mode must support stopping partway with no lost state.

## Proposal

### P1 — `/nightwatch review` command mode

A new argument to the orchestrator command (mirroring how `init` is a mode of `/nightwatch`):
`/nightwatch review [--repo .] [--brief <date>]`. Namespaced plugin form:
`/nightwatch:nightwatch review`. Default target is the latest brief (`MORNING.md`); `--brief`
reviews a specific dated brief.

### P2 — One finding at a time, three actions

The command walks the brief's findings in rendered order (blockers first — the brief's own
priority order). For each finding it shows the finding's one-line summary plus its evidence
line, and offers:

| Action | Effect |
|---|---|
| **Acted on** | `recordFeedback(id, 'acted-on')`; checkbox set to `[x]` |
| **Dismiss** | `recordFeedback(id, 'dismissed')`; checkbox set to `[-]` |
| **Skip for now** | nothing recorded; checkbox untouched; finding remains eligible next session |

- Already-marked findings (from a previous session or manual edit) are shown pre-resolved
  and skipped by default; a `--all` flag revisits them.
- The user can stop at any point; everything decided so far is already recorded (each
  decision is written as it is made, not batched at the end).
- The flow is strictly selection-based: the three actions above are the entire input
  vocabulary. No typing, no free-text.

### P3 — Deterministic write layer

Interpretation (presenting findings, collecting choices) is the interactive layer's job;
writing is delegated to a deterministic script, matching the init pattern
("the interview is yours to conduct; the file writing is deterministic"):

```
node ${NW_ROOT}/scripts/review-feedback.js --repo . --id <finding-id> --mark acted-on|dismissed
```

The script (a) appends the feedback row via `recordFeedback()`, dated to the brief being
reviewed, (b) rewrites the corresponding checkbox in `MORNING.md` and the dated brief file so
file state matches ledger state, and (c) is a no-op with a clear message if the id is already
recorded. Constraint 2 (file/ledger consistency) and constraint 3 (idempotency) live in this
script, not in the conversation.

### P4 — Coexistence with backfill

`backfill-feedback.js` keeps its exact behavior: it reads checkbox marks and skips ids
already recorded. Because P3 writes both the ledger row *and* the checkbox, an
interactively-reviewed finding appears to backfill as already-recorded — nothing
double-counts, in either order (interactive then backfill, or manual edit then interactive).

### P5 — Discoverability from the brief

`MORNING.md` gains one footer line (written by `collect-brief.js`):

```
Review these findings interactively with /nightwatch review — or mark boxes by hand: [x] acted on, [-] dismissed.
```

This fixes the undiscoverable-syntax problem for both input methods at once.

## Non-goals

- No new tracking backend and no ledger schema change.
- No editing of finding *content*, severity, or ranking from the review flow — feedback is
  acted-on/dismissed/skip only.
- No automatic inference of "acted on" from git history (a possible future refinement;
  explicitly out of scope here).
- No change to the demotion rule's computation — it simply receives better-fed inputs.

## Acceptance criteria

1. `/nightwatch review` walks the latest brief's unmarked findings in brief order, offering
   Acted on / Dismiss / Skip for each, and requires no manual file editing.
2. Each decision immediately produces exactly one ledger feedback row via `recordFeedback()`
   and the matching checkbox update in `MORNING.md` and the dated brief.
3. Quitting mid-review loses nothing: recorded decisions persist; skipped and unseen
   findings remain unmarked.
4. Running backfill after an interactive session (or vice versa) records no duplicate
   feedback rows, in any interleaving with manual checkbox edits.
5. The brief's footer names both feedback methods; the checkbox syntax is documented in the
   brief itself.
6. The overnight flow is byte-identical to today when the review mode is never used.
