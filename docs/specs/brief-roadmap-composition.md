# Spec: Roadmap-first morning brief — orientation before triage, open work until resolved

- **Status:** accepted 2026-07-11 — **folded into `nightwatch.md`** §6, superseding parts
  of [brief-composition](brief-composition.md) (P2 section order, P6 "Where you stand")
  while keeping its mechanics (status line, single first action, fold, action grammar,
  bundling, id manifests, feedback fan-out). **FR assignment deferred.**
- **Motivated by:** dogfooding findings
  [0018 — roadmap-first](../dogfooding/0018-roadmap-first-brief.md) and
  [0020 — temporal orientation](../dogfooding/0020-morning-brief-temporal-orientation.md);
  the road section validated by the maintainer's round-2 prototype read
  ([feedback](../prototypes/MORNING-2026-07-11-feedback.md), point 3).
- **Governed by:** [writing-harness](writing-harness.md) — objective: *productive work
  within 3 minutes*; all W-rules apply to every section below.
- **Scope:** `MORNING.md`'s section order, each section's reader question and data
  source, and one change to what the brief renders (open findings, not only tonight's).
  Caps, ranking classes, manifests, bundling, and determinism are unchanged.

## Problem

The Epic 8 brief triages findings but never orients the maintainer: it doesn't say what
they finished, where they are on the road to their goal, or how today's action moves
them along it (0018/0020). And it renders only *tonight's* findings, so unresolved work
can silently vanish between runs (0019).

## P1 — Composition (normative order, with each section's reader question)

| # | Section | Reader question it answers |
|---|---|---|
| 1 | Title + date | which morning is this |
| 2 | **Status line** | is anything on fire? |
| 3 | `## Since yesterday` | what did I just finish? |
| 4 | `## The road to release` | what's the goal, where am I, what's next? |
| 5 | `## ▶ First action` | what single thing do I do right now? |
| 6 | `## If you have energy after that` | what comes after that? |
| 7 | fold marker | (everything below is optional) |
| 8 | `## Details` | how exactly do I do each task? |
| 9 | `## Machine notes — nothing to act on` | what did the machine want me to know? |
| 10 | footer | how do I give feedback? |

The status line keeps FR56's count derivation. Sections 3–5 must all land above the fold.

## P2 — `## Since yesterday` (new; 0020)

Machine-derived, maintainer-perspective: merges/commits on the default branch since the
previous brief's date (from `universal-git`, already collected), tracker items completed
and milestone movement (from the tracker store), and **findings resolved** (from the
finding lifecycle, [finding-lifecycle](finding-lifecycle.md) — e.g. "RC-… resolved: the
cited drift is gone"). Rendered per W2 (title-first references) and W10 (the *maintainer*
finished things; the tool observed them). A no-change night renders exactly one line:
"Nothing new since the last brief." Deterministic given identical inputs.

## P3 — `## The road to release` (replaces FR61's "Where you stand")

Renders the journey defined by [release-journey](release-journey.md) P2, compactly:

- The goal, verbatim from the declaration, attributed ("Your goal — STATE.md: …").
- The ordered milestones with ✓ ▶ ○ marks, current one tagged *you are here*; at least
  the next and following milestones always visible (W3), ending with the 🏁 line.
- The waivable hygiene gate labeled per W5.
- One `**Blocking the release:**` line — named blockers or "nothing" (W5 vocabulary).

Fallbacks: no release tracker → the single existing hint line ("No RELEASE.md yet —
run `/release-progress`"). Tracker present but no `milestones:` declared → the flat
done/total ratio + remaining criterion titles (FR61's rendering) plus one setup nudge to
declare milestones — the road degrades to the ratio, never breaks.

## P4 — The brief renders OPEN findings, not only tonight's (0019/0020)

The action sections draw from the set of **open findings** — ledger state per
[finding-lifecycle](finding-lifecycle.md): found, not resolved, not dismissed — not
merely tonight's findings JSON. Each action line carries freshness from the lifecycle
classification (re-observed tonight / evidence still present / not re-examined since
DATE), rendered as a short suffix. Consequences, all deliberate:

- An unresolved finding **stays in the brief** until resolved or dismissed — it can no
  longer vanish silently (the RC-615fba failure mode).
- Resolved findings exit the action list and appear once under `## Since yesterday`.
- `caps.brief_total` applies to the open set; ranking classes and the appendix are
  unchanged.

## P5 — First-action selection gains a continuity tiebreak (0020)

Selection order becomes: priority class → severity → **advances-the-current-milestone**
(boolean, from the tracker's cross-reference of finding ids to milestone criteria) →
`effort_min` (absent last) → id. Strictly a tiebreak insertion: blockers and decisions
still outrank everything; among equals, work that moves the road wins. Deterministic.

## P6 — Action and Details grammar (W-rules applied)

- Action lines keep FR58's grammar (checkbox, bold verb-first summary, command block,
  manifest comment) plus: the milestone the action advances, **by name, in words** (W3/W4),
  and self-containment (W7) — no action assumes yesterday's context.
- One line under the `## ▶ First action` heading, once per document, explains the
  affordance: *"Tick `[x]` when done, `[-]` to dismiss — Nightwatch reads it back."* (W6;
  the footer keeps the full text.)
- `## Details` entries are **work briefings** (W9): *what to change / why it's necessary /
  expected outcome and how to verify*, one block per action, in brief order; the finding
  appendix (ids, evidence, severity — required by the feedback loop) and the ids-only
  overflow appendix close the section.

## Supersession map

| Prior rule | Disposition |
|---|---|
| FR55 composition order (status → First action → energy → Where you stand → fold …) | superseded by P1 (Since yesterday and the road move above the actions; Where-you-stand absorbed into the road) |
| FR61 "Where you stand" block | superseded by P3 (survives as the no-milestones fallback) |
| FR56 status line, FR57 selection, FR58 grammar, FR59 bundling, FR60 fan-out | kept (P5 inserts one tiebreak into FR57; P6 extends FR58's content, not its mechanics) |
| brief renders tonight's findings | superseded by P4 (open findings) |

## Non-goals

- No change to caps, ranking classes, manifests, bundling equality rule, fold, footer
  mechanics, ledger schema (lifecycle rows are finding-lifecycle's concern), or
  byte-determinism.
- No LLM in the collector; Since-yesterday/road/Details prose fields are authored by the
  judgment layer under the harness and composed mechanically.

## Acceptance criteria

1. Sections render in the P1 order; Since yesterday, the road, and the First action all
   appear above the fold; every section's reader question is declared in the spec fold.
2. `## Since yesterday` lists merges/completions/resolved findings from fixture git +
   tracker + lifecycle data; a no-change fixture renders exactly the one-line form.
3. The road renders goal, ✓ ▶ ○ marks with the current milestone tagged, next and
   following milestones visible, the W5 blocker line; the no-milestones fixture falls
   back to ratio + remaining titles + setup nudge.
4. A finding open from a previous run and not re-observed tonight still renders in the
   action sections with its freshness suffix; a resolved fixture finding moves to Since
   yesterday and out of the actions.
5. At equal class/severity, a finding advancing the current milestone is selected as
   First action over one that doesn't; with no milestone linkage the FR57 order is
   unchanged byte-for-byte.
6. Identical inputs render a byte-identical brief (NFR8), including the new sections.

## Tests

- Golden composition fixture (the writing-assistant 2026-07-11 dataset) matching the
  validated prototype's structure.
- Since-yesterday derivations: merge-only, completion-only, resolution-only, no-change.
- Road fallback matrix: no tracker / tracker without milestones / full milestones.
- Open-set rendering: open-not-reobserved, resolved, dismissed fixtures; cap applied to
  the open set.
- Selection tiebreak: milestone-linked vs unlinked at equal rank/severity/effort.
- Determinism: shuffled inputs → byte-identical output.
