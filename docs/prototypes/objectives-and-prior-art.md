# Primary objectives & prior-art notes — working input for the writing-harness spec

- **Status:** working notes, 2026-07-11 — step 1+2 of the 0018–0024 triage plan.
  **Objectives confirmed by the maintainer 2026-07-11** and folded into
  [`docs/specs/writing-harness.md`](../specs/writing-harness.md) P1 (canonical from that
  point; this file remains as the design-input record). The prior-art survey is a desk
  pass; the harness spec carries the distilled rules.
- **Feeds:** `docs/prototypes/MORNING-2026-07-11.md`, `docs/prototypes/RELEASE-2026-07-11.md`
  (both written under these objectives), then `docs/specs/writing-harness.md`.

## 1. Draft primary objectives (0023 — one falsifiable sentence per document)

| Document | Primary objective | Test |
|---|---|---|
| `MORNING.md` | The maintainer begins productive work within **3 minutes** of opening it. | Cold read, timed: from open to first keystroke of real work. |
| `RELEASE.md` | The maintainer can state the release goal, their current milestone, and the next milestone within **1 minute** of opening it. | Cold read, timed: say the three answers aloud. |

Derived inclusion rule (applies to every sentence in both documents): *if removing the
sentence would not slow the reader's path to those answers, it moves below the fold or
out of the document.*

## 2. Prior-art patterns and what each contributes

| Pattern | Source domain | Rule distilled for the harness |
|---|---|---|
| Daily standup (yesterday / today / blockers) | Scrum ritual | Temporal continuity block: *finished → in progress → next* — 0020's three questions verbatim; written from the **maintainer's** perspective, not the tool's |
| BLUF (bottom line up front) | military/executive briefing | Every section's first sentence is its conclusion; nothing above the fold requires reading past it to know what to do |
| "Changelogs are for humans" | Keep a Changelog | Group by meaning, never chronology; latest first; a log entry states impact-on-reader before mechanism |
| Project status update (health + delta + next) | Linear/Basecamp-style updates | One health signal line (on track / at risk / blocked) → what changed since last update → what happens next; fits one screen |
| Milestone roadmap / burn-up | release planning | Position is a marker on an **ordered path** (✓ ▶ ○), never a bare percentage; the next milestone is always visible |
| Inverted pyramid | journalism | Detail decays downward; the fold (already shipped, FR55) is this pattern — keep it |

## 3. Contract rules the prototypes exercise (candidate harness content)

1. **Health first** — one bold sentence, count-derived (shipped as the status line; kept).
2. **Continuity second** — "Since yesterday" block: what merged/completed, machine-derived
   from git history + tracker deltas (0020).
3. **Road third** — goal (verbatim from `STATE.md`), ordered milestones with ✓/▶/○
   markers, blockers named or "nothing" (0018/0021).
4. **One first action** — selected for continuity with the current milestone where
   severity permits (shipped mechanics, re-aimed).
5. **Every block opens with its answer** (BLUF); ids, evidence, and history only below
   the fold (shipped, FR55/FR58 — kept).
6. **Status entries answer "what changed since yesterday, and does it need you?"** —
   never a run log (0022's rewrite rule).

## 3b. Rules added by prototype round-2 feedback (2026-07-11)

From the maintainer's cold read of `MORNING-2026-07-11.md` — full record with verdicts in
[`MORNING-2026-07-11-feedback.md`](MORNING-2026-07-11-feedback.md); the road-first
structure was validated, the *writing* was not:

- **W1 — no hard wraps:** never wrap inside a sentence; one bullet = one source line.
- **W2 — self-evident references:** no bare `#N`; title-first with the number
  parenthesized, or repo-prefixed (finding 0025).
- **W3 — the road continues:** always show next + following milestones, and each action
  names (in words) the milestone it advances and what closing it unlocks.
- **W4 — no unexplained derivations:** no bare arithmetic ("half"), no ordinal-only
  milestone references ("milestone 3"), no purpose-free parentheticals; estimates carry
  their basis or are dropped.
- **W5 — one work vocabulary:** *blocker / remaining work / waivable gate / later
  milestone* — exact, exclusive, every new noun mapped to one.
- **W6 — one register, explained affordances:** uniform style whole-document; feedback
  checkboxes explained at first use and visually distinct from roadmap marks (✓ ▶ ○).
- **W7 — context restoration:** every action self-contained for a reader who forgot
  yesterday: what to change, why, expected outcome.
- **W8 — whole-document governance:** the style contract covers every section, with
  mechanical checks where possible (the prototype's quality decayed after the road).
- **W9 — Details is a work briefing:** per task — what to change / why necessary /
  expected outcome + verification; provenance and run history go to the appendix.
- **Summary rule — perspective inversion:** write as the maintainer's chief of staff,
  never as the tool's narrator; every sentence passes the primary-objective test.

## 4. Open questions for the spec (not resolved by the prototypes)

- Milestone ordering needs a declaration (`STATE.md` `release:` — ordered
  `definition_of_done` or explicit `milestones:`); 0021. The prototypes *assume* the
  declared DoD list order is the journey order.
- Stale-tick re-verification (the "all epics complete" mark recorded at 6 epics while the
  plan grew to 8) — the prototypes render the re-confirmed state; whether re-verification
  is release-progress's job each night belongs in the finding-lifecycle/harness specs.
- The hygiene checks' place on the road (generic gate before tagging vs. peer
  milestones) — prototyped as a trailing gate; confirm at spec time.
