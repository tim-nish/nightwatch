# Spec: Writing harness — every generated document is written to a declared objective, under a per-surface contract

- **Status:** accepted 2026-07-11 — **folded into `nightwatch.md`** §2.9 (new), referenced
  from §5 and §6. **FR assignment deferred** to the BMAD planning update.
- **Motivated by:** dogfooding findings
  [0022 — writing harness](../dogfooding/0022-writing-harness.md),
  [0023 — primary objectives](../dogfooding/0023-document-primary-objective.md),
  [0025 — repo-context ambiguity](../dogfooding/0025-repo-context-ambiguity.md); rules
  W1–W9 from the [prototype round-2 feedback](../prototypes/MORNING-2026-07-11-feedback.md).
- **Design inputs:** [`objectives-and-prior-art.md`](../prototypes/objectives-and-prior-art.md)
  (objectives **confirmed by the maintainer 2026-07-11**; prior-art survey),
  prototypes `MORNING-2026-07-11.md` and `RELEASE-2026-07-11.md`.
- **Scope:** *how* generated documents are written — objectives, per-section communication
  contracts, style rules, citation integrity, and where each rule is enforced. The
  *composition* of each surface (which sections, in what order) lives in
  [brief-roadmap-composition](brief-roadmap-composition.md) and
  [release-journey](release-journey.md), both governed by this spec.

## Problem

Prose quality tracks the presence of a writing contract, not model capability: the one
field with a declared grammar (`next_step.summary`, FR54) reads well; every surface
without one (status entries, item text, section prose) defaults to execution-log style
written from the tool's perspective (0022, round-2 feedback points 5–10). Nothing defines
whom a sentence is for, what question it answers, or whether it belongs in the document
at all.

## P1 — Primary objectives (confirmed; the root of every other rule)

| Document | Primary objective | Acceptance test |
|---|---|---|
| `MORNING.md` | The maintainer begins productive work within **3 minutes** of opening it. | Timed cold read: open → first keystroke of real work. |
| `RELEASE.md` | The maintainer can state the release goal, the current milestone, and the next milestone within **1 minute** of opening it. | Timed cold read: say the three answers aloud. |

**Inclusion rule (normative, per sentence):** if removing a sentence would not slow the
reader's path to the objective, it moves below the fold, to an appendix, or out of the
document. Any future generated document must declare its objective here before it ships.

## P2 — Communication contract per section

Every section a composition spec defines must declare **the reader question it answers**.
Sections open with their answer (BLUF); a sentence that answers no declared question is
cut. The composition specs carry the per-section question tables; this spec makes the
mechanism mandatory.

## P3 — Style rules (normative for all generated prose)

- **W1 — no hard wraps:** never wrap inside a sentence; one bullet = one source line.
- **W2 — self-evident references:** no bare `#N`. Cite title-first with the number
  parenthesized — *"Story 7.4: stage-0 configuration validation (PR #78)"* — or
  repo-prefixed (`writing-assistant#78`).
- **W3 — the road continues:** wherever a milestone path renders, at least the next and
  following milestones are visible, and each action names — in words — the milestone it
  advances and what closing it unlocks.
- **W4 — no unexplained derivations:** no bare arithmetic ("half"), no ordinal-only
  milestone references ("milestone 3" → use its name), no purpose-free parentheticals;
  estimates state their basis or are dropped.
- **W5 — one work vocabulary:** *blocker* (stops the release) / *remaining work* (inside
  the current milestone) / *waivable gate* (optional, generic) / *later milestone*.
  Exact and exclusive; any new noun for work maps to one of these.
- **W6 — one register, explained affordances:** uniform style across the whole document;
  interactive affordances (feedback checkboxes) explained at or before first use;
  roadmap marks (✓ ▶ ○) visually distinct from feedback checkboxes (`[ ]`).
- **W7 — context restoration:** every action is self-contained for a reader who has not
  thought about the issue since yesterday: what to change, why it matters, expected
  outcome.
- **W8 — whole-document governance:** these rules bind every section equally (observed
  failure: quality decayed after the lead sections).
- **W9 — Details are work briefings:** per task — *what exactly to change / why the
  change is necessary / what outcome to expect and how to verify it*; discovery
  provenance and run history go to the appendix or Machine notes.
- **W10 — perspective inversion (summary rule):** write as the maintainer's chief of
  staff, never as the tool's narrator.

## P4 — Where each rule is enforced (the harness architecture)

Respecting the deterministic/judgment split (principle 4, NFR8):

1. **Judgment layer (prompts):** each prose-producing job receives its surface's
   contract — objective, section reader-questions, W-rules — injected verbatim into its
   prompt. Prose is authored once, as structured fields, not free text.
2. **Deterministic collector (lints):** mechanical rules are checked at assembly time —
   mid-sentence hard-wrap detection (W1), bare-`#N` detection (W2), vocabulary check for
   the four W5 category nouns in status/road lines, length caps. A lint failure falls
   back to the field's mechanical rendering (title fallback), never to broken output.
3. **Adversarial pass (verification):** gains a **reader-question check** — for each
   authored field, the verifier is told the question the field must answer and refutes
   fields that don't answer it — alongside the existing truth check.

## P5 — Citation integrity (0025)

1. **Reference grammar** is W2 (above).
2. **Deterministic reference check (collector, no network):** every PR/commit number a
   document cites must match the target repository's own git history (e.g.
   `Merge pull request #N` merge commits, local object ids). A citation matching nothing
   local is flagged in Machine notes and rendered without its number, never silently
   trusted.
3. **Own-state isolation (judgment layer, normative):** generated documents may
   reference only artifacts of the target repository; every member-job prompt restates
   this, and the adversarial pass refutes any citation it cannot locate under the target
   repo root. Dogfooding — where Nightwatch's own repo is in the session — is the common
   case, not the edge case.

## P6 — Status-entry contract (0022's rewrite rule)

Tracker status entries answer, in order: **what changed since yesterday, and does it
need you?** Impact before mechanism; one entry, latest first, capped as today. A
no-change night states that in those terms ("No forward movement; nothing needs you"),
never as a run log ("forced re-run: progress unchanged at 0.67").

## Prior art (what each pattern contributed)

Daily standup → the finished/now/next block (0020). BLUF → P2's answer-first rule.
Keep a Changelog ("changelogs are for humans") → W2/W4 and the P6 impact-first order.
Linear/Basecamp-style updates (health → delta → next) → status line + Since-yesterday +
road sequencing. Milestone roadmaps → ✓ ▶ ○ position markers over bare percentages.
Inverted pyramid → the fold (already shipped, FR55; retained).

## Non-goals

- No LLM call inside `collect-brief.js` or the tracker — the collector lints and
  composes; it never writes prose.
- No change to caps/ranking (NFR7), byte-determinism (NFR8), checkbox/id manifests
  (FR58/FR60), or byte-preserved human content (FR17).
- No retroactive rewriting of ledger or historical briefs.

## Acceptance criteria

1. Both objectives and the inclusion rule appear in the folded spec; every section of
   both composition specs declares its reader question.
2. Prompt injection: each prose-producing job's prompt contains its surface contract;
   removing the contract is detectable by fixture (fields fail the reader-question check).
3. Collector lints: a mid-sentence hard wrap, a bare `#N`, and an off-vocabulary work
   noun in a status/road line are each flagged deterministically; lint failure falls
   back to mechanical rendering, never crashes.
4. Citation check: a fixture brief citing a PR number absent from the target repo's
   history renders the citation flagged and numberless, with one Machine-notes line.
5. Status entries on fixture nights (change / no-change / regression) each open with
   impact-on-reader, verified against the P6 grammar.
6. Timed cold-read tests are part of dogfooding acceptance for any composition change:
   MORNING ≤ 3 min to productive work; RELEASE ≤ 1 min to goal/current/next.

## Tests

- Lint unit tests (W1/W2/W5 detectors; fallback rendering).
- Reference-check tests: valid local PR number passes; unknown number flagged; commit
  ids resolved against the fixture repo.
- Prompt-contract fixtures: contract text present in each job's assembled prompt.
- Golden briefs: harness-authored fields render byte-deterministically (NFR8 preserved).
