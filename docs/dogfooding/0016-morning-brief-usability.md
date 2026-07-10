# Dogfooding finding 0016 — The morning brief is generated well but is not yet *usable*: it doesn't tell an exhausted reader what to do next

- **Date:** 2026-07-10
- **Session:** dogfooding — latest *writing-assistant* run. Different in kind from earlier rounds:
  this was the first session spent **using** the generated artifacts to actually start work, rather
  than evaluating how Nightwatch *creates* them.
- **Command:** none specifically — the subject is the output surface itself: `.nightwatch/MORNING.md`
  (assembled by `collect-brief.js`), plus `.nightwatch/briefs/` and `.nightwatch/ledger.jsonl` as
  encountered while reading it.
- **Classification:** output usability — the brief's content is correct and its assembly is
  deterministic as specified; the *reading experience* fails the product's core promise. Not a bug;
  a gap between "generated correctly" and "usable as intended."
- **Status:** documented only at first, deliberately — no redesign was proposed here so it could
  be scoped as its own step. **Update 2026-07-10:** scoped via the validated prototype
  [`docs/prototypes/MORNING-2026-07-10.md`](../prototypes/MORNING-2026-07-10.md) and folded into
  [`docs/specs/brief-composition.md`](../specs/brief-composition.md) (with
  [`docs/specs/output-file-taxonomy.md`](../specs/output-file-taxonomy.md) covering the
  file-descriptions half). No code changes implemented.

## The core observation

Nightwatch's stated goal is that the maintainer wakes up, opens **one file**, and knows what to do —
even when mentally exhausted (README: "`.nightwatch/MORNING.md`, the one file to open"). Using the
brief for real, that goal is not yet met: **after reading it, I still did not know the concrete next
action.** The brief succeeds as a *report* and fails as a *morning starting point* — and an unread
(or read-but-not-acted-on) report is negative value by the project's own principle.

## Observed problems

1. **Visually dense and tiring to read.** The brief is a wall of similar-weight sections and long
   bullet lines. Reading it takes effort at exactly the moment (morning, low energy) the design says
   effort should not be required.
2. **Bullets are paragraphs, not actions.** Individual items carry long explanatory text inline
   (title + evidence + qualifiers in one line) instead of a short, scannable action with detail
   available *afterwards*.
3. **No visual entry point.** Current section order is: Release progress → Human decisions →
   Consistency (repo-reconcile) → Architecture (arch-review) → Failures & degraded notices → Config
   drift → Appendix. Nothing tells the reader which section — or which single line — to look at
   first; every section presents with equal urgency.
4. **No concrete "do this next."** Even after a full read, the brief doesn't converge on an explicit
   next action. The reader must synthesize one themselves from findings scattered across sections —
   precisely the judgment work the tired-morning scenario is supposed to avoid.

## What using it suggested (recorded as observations, not yet design)

- **The top of the brief should be a very small "Today / Next actions" block**: a handful of
  explicit actions, with priority and ideally an estimated effort each, so the reader can start
  working without reading further. Detailed evidence and per-job sections can follow *below* for
  when there's energy to dig.
- **Markdown checkboxes are directly clickable** in VS Code and most Markdown tooling, which in
  practice may be a *more* convenient feedback mechanism than the interactive `/nightwatch review`
  walk. The review command may still earn its place (it explains findings, records feedback
  idempotently), but its value should be **reassessed against direct checkbox interaction** now that
  the checkboxes are the natural touch-point (the backfill path already honors hand-edited boxes,
  FR44).
- **`.nightwatch/briefs/` is unclear from the user's seat.** It appears to duplicate `MORNING.md`
  (the same content lands in both), and nothing in the output layout explains its retention or use
  case. The "dated briefs are memory, committed" rationale exists in the README file-layout table,
  but the duplication still reads as redundancy when encountered directly.
- **`ledger.jsonl` is an internal file the user would never open**, yet it sits beside the files the
  user *is* expected to read, with nothing in the layout distinguishing them. User-facing
  documentation should separate **operational/internal files** (ledger, `state.json`, `out/`) from
  **files the user is expected to read or edit** (`MORNING.md`, `RELEASE.md`, `STATE.md`,
  `config.yaml`).

## Why this matters

- **This is the product's core loop, not a peripheral surface.** Every night's tokens are spent to
  produce this one reading moment; if the brief doesn't convert to action, the whole pipeline's
  value is capped by it.
- **The failure mode is silent.** The brief looks complete and correct — nothing signals that a
  reader bounced off it. Only actually *using* the output (this session) exposed it.
- **Several prior findings sharpened pieces of the brief** (0010 progress formatting, 0013 drift
  noise, 0014 ratio context) — but this finding is about the *whole*: even with every line correct,
  the composition doesn't deliver "know what to do next."

## Risks

- The morning brief becomes something the user skims and abandons; feedback (checkbox marks) stops
  flowing; the demotion rule and re-ranking starve; the system's learning loop degrades.
- Duplicated-looking outputs (`MORNING.md` vs `briefs/`) and inscrutable internals (`ledger.jsonl`)
  erode trust in the layout ("what else here is noise?").

## Next step (not done here, on purpose)

Scope a redesign of the brief's composition — entry-point ("Today / Next actions") block, scannable
one-line actions with progressive detail, section priority — and a documentation pass separating
user-facing from internal files, plus a reassessment of `/nightwatch review` vs direct checkbox
interaction. That work should get its own spec once this finding is triaged; this document records
the evidence for it.
