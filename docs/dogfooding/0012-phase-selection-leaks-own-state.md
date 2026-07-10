# Dogfooding finding 0012 — Phase-selection UI leaks Nightwatch's own development state instead of describing the target repository generically

- **Date:** 2026-07-10
- **Session:** fourth dogfooding round — running Nightwatch on the *writing-assistant* repository,
  during `/nightwatch init`'s interview (the phase declaration).
- **Command:** `/nightwatch init`, at the **phase** step of the interview (authority → **phase** →
  release target / definition of done).
- **Classification:** UX / wording & presentation issue — not an implementation bug. The interview
  gathers the right declaration (`phase:`), and the phase ranking behaves as specified; the problem
  is that the *guidance shown while choosing* described the phase in **Nightwatch-specific** terms.
- **Status:** documented; proposed refinement folded into
  [`docs/specs/first-run-ux.md`](../specs/first-run-ux.md) (P8). No code changes implemented.

## Observed behavior

While configuring the **writing-assistant** repository, the phase-selection UI described the
project's phase using **Nightwatch's own development milestones** — e.g. *"Epic 6 packaging just
landed"* — rather than describing the phase of the repository actually being configured. Nightwatch
was being pointed at writing-assistant, but the interview narrated its *own* state as if it were the
subject.

## Where it's unclear / why this matters

1. **The subject of `init` is the target repository, not Nightwatch.** `/nightwatch init` configures
   whatever repo it is run in. Any guidance that references Nightwatch's own epics, packaging, or
   milestones is describing the wrong project — it is noise at best and misleading at worst, since a
   writing-assistant maintainer has no "Epic 6" and no reason to map Nightwatch's lifecycle onto
   their own.
2. **It leaks internal development state into a user-facing surface.** "Epic 6 packaging just
   landed" is Nightwatch-internal context. Surfacing it in a target repo's setup interview breaks
   the boundary between the tool and the repository it analyzes — the same
   repository-agnostic principle the rest of the design assumes (the jobs analyze *the product*,
   never Nightwatch itself).
3. **Phase is a declaration the user must reason about generically.** The value the user is choosing
   (`prototype` / `building` / `hardening` / `released`) is about *their* project's maturity.
   Illustrating it with Nightwatch's milestones invites a wrong or confused answer, and a wrong
   `phase:` silently reweights ranking (overengineering vs drift/coupling) for the rest of the runs.

## Risks

- A user mis-declares `phase:` because the guidance described Nightwatch's lifecycle, not theirs —
  skewing every subsequent run's ranking.
- Trust erodes when a setup tool talks about itself instead of the repository it was pointed at; it
  reads as a leak of the tool's internals rather than help configuring the user's project.
- The same leak can recur anywhere the interview narrates by example — authority, release target,
  definition of done — so the fix should be a stated principle, not a one-off wording patch.

## Suggested improvements (folded into `docs/specs/first-run-ux.md`, P8)

1. **Describe the phase (and every interview prompt) in repository-agnostic, generic terms.** Speak
   about *the repository being configured*, never about Nightwatch's own development. For phase, use
   generic descriptions of each value — e.g. *"Preparing the first public release"* for
   `hardening`/`released`, *"Actively building toward a first version"* for `building` — instead of
   any Nightwatch-specific milestone.
2. **Never reference Nightwatch's own epics, packaging, versions, or milestones** in any user-facing
   interview or confirmation text. Nightwatch is the tool; the repository it was pointed at is the
   subject.
3. **Make it a stated presentation principle, not a single wording fix**, so it holds for authority,
   release target, and definition-of-done prompts too — every example must be generic or drawn from
   the *target* repository, never from Nightwatch itself.
