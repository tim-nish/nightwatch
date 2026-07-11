# Dogfooding finding 0021 — RELEASE.md reports status; the maintainer needs the release *journey*

- **Date:** 2026-07-11
- **Session:** dogfooding — *writing-assistant*, reading the post-reorder `RELEASE.md`
  (reader-side section order from story 8.4 / finding 0017 P3).
- **Command:** `/release-progress` output surface.
- **Classification:** output usability / tracker composition. The 8.4 reorder put next
  actions first and history last — the right *order* — but the content is still a flat
  status report, not a journey.
- **Status:** documented; verbatim user feedback with review analysis.

## The feedback (user's own framing)

> The Release section currently reports percentages and hygiene checks, but it does not
> explain the release journey. What I expect is something like:
>
> - The current agreed release goal.
> - The remaining milestones required to reach that goal.
> - Which milestone is currently in progress.
> - Which milestone comes next.
> - What is blocking the release, if anything.
>
> In other words, I want a roadmap, not just a status report.

## Review analysis

**Most of the data exists; the *structure* doesn't.** Mapping the five expectations onto
today's writing-assistant `RELEASE.md`:

| Expectation | Present today? | Where / gap |
|---|---|---|
| Agreed release goal | partially | `target:` renders as a frontmatter field and a clause in progress lines — never stated as a goal with its definition |
| Remaining milestones | flat, unordered | DoD items + `RP-`/`RC-` items in "Remaining — implementation/documentation", mixed with generic hygiene at equal weight |
| Milestone in progress | buried | "[DoD-3, in progress]" exists as bracketed text inside one item — a convention the writer improvised, not a structure |
| Next milestone | absent | "Next actions (top 3)" are *tasks*, not the next milestone; nothing orders the journey |
| Release blockers | **yes** | the "Release blockers" section answers this cleanly — keep |

**The structural root: `definition_of_done` is an unordered checklist.** `STATE.md`
declares DoD as a flat YAML list, so the tracker can only render a flat list. "Milestone
in progress / next milestone" requires an *ordering* (and optionally grouping) that no
declaration currently carries — per principle 5, that ordering is a human judgment and
would need to be *declared*, not inferred (e.g. `release.milestones:` as an ordered list,
or order-significant `definition_of_done`).

**Percentages and hygiene dominate because they're what's computable.** `progress: 0.67`
and the release-checks are deterministic, so they lead; the journey is judgment-shaped, so
it's absent. This is the same pattern as 0020: the machine renders what it can compute,
not what the reader needs to decide.

**What the ratio work (0014/8.4) did and didn't fix:** "2/3 criteria" made the number
honest; it did not make it a *path*. A percentage of an unordered set can't say "you are
here."

## What this suggests (observations, not yet design)

- A **declared milestone order** in `STATE.md`'s `release:` block (ordered
  `definition_of_done` treated as sequence, or an explicit `milestones:` list) — a
  daytime, `init --update`-mediated declaration.
- RELEASE.md's top rendered as a **journey block**: goal statement → milestone list with
  done/current/next markers (`✓ / ▶ / ○`) → blockers — with hygiene checks demoted to a
  supporting section, not peers of the DoD.
- The brief's "Where you stand" (FR61) then inherits the same three markers instead of
  only the ratio — directly answering 0018's Q3 ("where am I on the path").

## Next step

Spec alongside 0018/0020 (the roadmap trio); requires a small `STATE.md` declaration
extension, so the spec must cover the declared-not-inferred boundary and `init --update`
support. The prose of the journey block falls under the writing harness
([0022](0022-writing-harness.md)).
