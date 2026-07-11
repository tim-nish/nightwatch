# Dogfooding finding 0020 — The brief answers "what did the tool find?", never "what did I just finish, what am I doing, what's next?"

- **Date:** 2026-07-11
- **Session:** dogfooding — *writing-assistant*, continued morning use of the Epic 8-era
  brief (same round as [0018](0018-roadmap-first-brief.md)/[0019](0019-finding-disappearance.md)).
- **Command:** none — the subject is `MORNING.md`'s content priorities.
- **Classification:** output usability / composition. Sibling of 0018: 0018 asks for the
  *spatial* orientation (goal → remaining steps → position on the path); this finding asks
  for the *temporal* one (just finished → in progress → next), plus a repurposing of the
  Details section.
- **Status:** documented; verbatim user feedback with review analysis.

## The feedback (user's own framing)

> When I open MORNING.md, I want to understand, within a few seconds:
>
> - What did I just finish?
> - What am I working on now?
> - What should I work on next?
>
> Those three questions should be the primary focus of the brief. The current Details
> section is mostly a collection of findings, IDs, evidence paths, and internal metadata.
> While that information can exist somewhere, it should not occupy the most visible part of
> the morning report. Instead, the Details section should explain the current work and
> upcoming work in a way that directly helps me continue development.

## Review analysis

**The sharp observation: the brief never tells the maintainer what *they* did.** Every
line of the current brief is machine-perspective — what the jobs found, what degraded, what
the tool wants acted on. Nightwatch already *collects* the data the temporal questions
need and renders none of it:

- *"What did I just finish?"* — `universal-git` extracts churn and recent history every
  run; the tracker moves items to Done with dates; release-progress appends status entries
  naming completions. None of this renders as "yesterday you merged X / completed DoD
  item Y."
- *"What am I working on now?"* — inferable from recent-commit clustering and the
  in-progress DoD item (`RELEASE.md` marks DoD-3 "in progress" today); never surfaced.
- *"What should I work on next?"* — exists as `RELEASE.md`'s "Next actions (top 3)" and
  the brief's First action, but the First action is *findings-derived* (tonight it was
  "add a CHANGELOG" — a hygiene gap), not *work-continuation-derived* ("continue the
  visuals epic you merged five PRs into yesterday").

**Where this confirms the shipped design:** the 30-second contract, the fold, and the
one-first-action mechanics (0016 → Epic 8) are not disputed — the user reads the top and
wants *different content* there, not a different shape.

**Where it challenges it:** FR55 fills the top with triage of findings; the user wants the
top filled with *continuity of work*, findings attached where they affect it. And the
Details section (per FR55/FR58, deliberately the home of ids/evidence/severity so action
lines stay clean) is being read as "the most visible part" — evidence that once the fold
is crossed, the reader expects *narrative* (current work, upcoming work), not the finding
appendix it currently is. The ids/evidence must live somewhere (the feedback loop and
review mode depend on them), but they may belong further down, below a work-narrative
block.

## What this suggests (observations, not yet design)

- A **"Since last brief" block** — machine-derived from git history + tracker deltas
  (items completed, PRs merged, DoD movement) — answering "what did I just finish" with
  zero new declarations.
- **First action selected for continuity, not only severity** — the ranking could weight
  "advances the in-progress DoD item / continues yesterday's work cluster" alongside the
  existing class/severity order.
- **Details restructured as: current work → upcoming work → (then) finding appendix** —
  narrative first, metadata last, ids preserved for the feedback loop.
- Combined with 0018, the emerging shape is one orientation block: *where you've been
  (temporal) + where you're going (spatial) + what to do next* — the two findings should
  be specced together.

## Next step

Triage with 0018 into a single brief-composition revision; the writing-harness direction
in [0022](0022-writing-harness.md) is the vehicle for the narrative blocks this finding
asks for.
