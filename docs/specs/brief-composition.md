# Spec: Morning-brief composition — the first concrete action within 30 seconds

- **Status:** accepted 2026-07-10 — **folded into `nightwatch.md`** §2.5 (findings contract:
  `next_step`), §6 (brief assembly, morning feedback loop, `review` mode, acceptance criteria).
  **FR assignment deferred** to the BMAD planning-artifacts update (not yet generated).
- **Motivated by:** dogfooding findings
  [0016 — Morning brief is generated well but not yet usable](../dogfooding/0016-morning-brief-usability.md)
  and [0017 — Output file descriptions](../dogfooding/0017-output-file-descriptions.md).
- **Primary design input:** the validated prototype
  [`docs/prototypes/MORNING-2026-07-10.md`](../prototypes/MORNING-2026-07-10.md) — a hand
  rewrite of a real brief (writing-assistant, 2026-07-10) against the single goal *"an
  exhausted maintainer knows the first concrete action within 30 seconds."* This spec derives
  composition rules **from** that artifact; where prose here and the prototype's shape
  disagree, the prototype's reading experience is the intent.
- **Composes with:** [release-progress-display](release-progress-display.md) (0014 — the
  ratio the "Where you stand" block renders) and
  [reconcile-patch-workflow](reconcile-patch-workflow.md) (0015 — the apply-command framing
  the First action uses). The prototype instantiates both proposals.
- **Scope:** what the brief *says and in what order*, and the one findings-schema field that
  feeds it. No change to what jobs detect, how findings are verified, the caps, the ledger
  schema, or the demotion rule.

## Problem

The brief succeeds as a *report* and fails as a *morning starting point* (0016): sections of
equal visual weight, paragraph-length bullets carrying title + evidence + qualifiers inline,
no entry point, and no explicit "do this next" — the reader must synthesize the next action
from findings scattered across sections, which is exactly the judgment work the tired-morning
scenario exists to avoid. Every night's tokens are capped by this one reading moment.

## Design constraints (invariants this spec must not break)

1. **Deterministic assembly** (principle 4). `collect-brief.js` stays mechanical: every line
   is rendered from job-output JSON by fixed rules. All judgment content this spec introduces
   (action summaries, effort estimates) is authored by the jobs' judgment layers and passes
   the same adversarial verification as the finding it belongs to.
2. **Caps and ranking preserved** (principle 2). `caps.brief_total` counts findings exactly
   as today; the interleave priority (blockers > human decisions > drift > arch >
   nice-to-have) is unchanged; overflow still lands in an ids-only appendix.
3. **The feedback loop stays mechanical.** Every rendered checkbox maps to its finding id(s)
   parseably; backfill and `review` idempotency (FR44 semantics) are unchanged.
4. **Byte determinism.** Identical inputs render an identical brief.
5. **The 30-second contract.** Status, the first action, and the release position must all
   land before any evidence, id, or degraded notice — "above the fold."

## Proposals

### P1 — Findings schema: optional `next_step`

The shared findings contract gains one optional field, written by the job's judgment layer
and reviewed by the same adversarial pass as the finding itself:

```json
"next_step": {
  "summary":    "Apply the ready-made README fix",
  "command":    "git apply .nightwatch/out/reconcile-2026-07-10.patch",
  "effort_min": 2
}
```

- `summary` — imperative, verb-first, ≤ 60 chars: what the human *does*, not what the tool
  found. Required within `next_step`.
- `command` — optional, copy-pasteable as-is (composes with 0015: for patches this is the
  `git apply` line, never an offer to apply).
- `effort_min` — optional coarse estimate in minutes, rendered `~N min`; the `~` carries the
  imprecision.

The collector renders action lines from `next_step` mechanically and **falls back to
`title`** when it is absent — the composition degrades, it never breaks.

### P2 — Normative brief composition

Fixed order, replacing the current section list:

1. **Title + date.**
2. **Status line** — one bold sentence answering "is anything on fire?" (P4).
3. **`## ▶ First action`** — exactly one action (P3), fully renderable without reading on.
4. **`## If you have energy after that`** — the remaining actions, interleave-priority
   order, same grammar (P5).
5. **`## Where you stand`** — release position (P6).
6. **Fold marker** — a horizontal rule plus *"Everything below is supporting detail. You can
   stop reading here."*
7. **`## Details`** — one anchor-linked subsection per finding/action: evidence pointers,
   severity, human-visible ids, blast radius where present; the overflow **appendix (ids
   only)** closes this section.
8. **`## Machine notes — nothing to act on`** — degraded notices (including which extractor
   adapters ran, were skipped, or crashed), zero-finding jobs ("Architecture review: 0
   verified findings this week"), and the scope line. Zero-finding jobs render here, never
   as empty sections above the fold.
9. **Footer** — both feedback methods and the counts (unchanged content).

### P3 — First-action selection is mechanical

The First action is the top finding by: interleave priority class → severity (ascending) →
`effort_min` (ascending, absent sorts last) → id (lexicographic tiebreak). Exactly one. A
`human-decision` finding is an action too ("Decide: …") — when decisions outrank everything
else, deciding *is* the first action.

### P4 — Status line derived from counts

| Condition (evaluated in order) | Status line |
|---|---|
| ≥ 1 severity-1 blocker | "**N release blocker(s).** Start below." |
| else ≥ 1 human decision | "**N decision(s) need you.** Nothing else is blocking." |
| else ≥ 1 actionable finding | "**Quiet night.** Nothing is blocking, no decisions needed, nothing broke." + one clause naming what waits (e.g. "One ready-made fix is waiting for you.") |
| else (zero findings) | "**Quiet night.** Nothing needs you today." |

A crashed or timed-out member job is appended to the status line ("— one job failed, see
Machine notes"), never hidden below the fold alone.

### P5 — Action-line grammar

Each action renders as:

```markdown
- [ ] **<verb-first summary>** — ~2 min, one command:

      git apply .nightwatch/out/reconcile-2026-07-10.patch

  <at most one plain-language sentence of why.> → [details A](#a)
```

- Checkbox first (the feedback touch-point), bold imperative summary, effort when estimated,
  the command block when present, one sentence of why in plain language, an anchor link to
  the finding's Details subsection.
- **Ids are invisible on action lines.** Each action line carries a manifest comment —
  `<!-- ids: RC-615fba -->` — that backfill and `review` parse; human-visible ids appear
  only in Details. The reader meets the action, never the code (0017).

### P6 — "Where you stand" replaces the embedded status entry

The release block renders: the ratio and percentage (0014 P1: "**2 of 3 release criteria met
(67%)**"), the target, the *titles* of remaining definition-of-done items, one clause linking
today's first action to the criterion it advances when the ids cross-reference, and a pointer
to the tracker file. It never embeds the tracker's full status-entry text — the current
verbatim duplication between `MORNING.md` and `RELEASE.md` (0017) is removed by construction.
When release-progress didn't run tonight, the existing staleness rule applies (last snapshot,
labeled).

### P7 — Bundling: one remedy, one action

Findings whose `next_step.command` is byte-identical merge into **one** action line; the
manifest comment lists every covered id. This is how N config-drift findings sharing
`/nightwatch init --update` become one "Tell Nightwatch about N new folders" action instead
of N sibling lines. Bundling is mechanical (exact command equality — no similarity
judgment); the cap still counts the underlying findings.

### P8 — Feedback fan-out for bundles

Marking a bundled checkbox (`[x]`/`[-]`, by hand or via `review`) records **one feedback row
per covered id** through `recordFeedback()` — same writer, same per-id idempotency, so
backfill/review/manual edits still compose in any interleaving without double-counting.
`review` mode walks rendered *action lines* (a bundle is one question, N rows); its
three-action vocabulary is unchanged.

**Review-mode reassessment (0016), resolved: keep it.** Checkboxes are the primary
touch-point and this spec optimizes for them; `review` survives because it shares the same
deterministic writer (`review-feedback.js`) and adds explanation on demand — it is a
front-end, not a second loop. No change beyond walking actions instead of raw findings.

## Non-goals

- No change to detection, adversarial verification, ranking-within-jobs, caps, ledger
  schema, or the demotion rule (P1's field travels in findings JSON, not the ledger).
- No LLM call inside `collect-brief.js` — composition is assembly, not judgment.
- No HTML beyond anchors and the invisible ids manifest comment.
- No change to `briefs/<date>.md` = `MORNING.md` byte-copy behavior (taxonomy spec describes
  it; this spec doesn't alter it).

## Acceptance criteria

1. A brief renders the P2 composition in order; evidence pointers, severities, and
   human-visible finding ids appear only below the fold marker; degraded notices and the
   scope line render under "Machine notes — nothing to act on".
2. Exactly one First action, selected by the P3 rule; when its finding carries a
   `next_step.command`, the command appears copy-pasteable in the First-action block.
3. Zero blockers and zero decisions → the status line reads "Quiet night…"; the same inputs
   plus one severity-1 finding flip it to name the blocker count — from counts alone.
4. Three config-drift findings sharing the `init --update` remedy render as one action line
   whose ids manifest lists all three; marking it `[x]` produces exactly three feedback rows;
   a subsequent backfill or `review` pass records no duplicates.
5. `next_step` absent on every finding → the full composition still renders from titles
   (fallback), with no blank sections and no crash.
6. The brief's "Where you stand" block shows the ratio + remaining criterion titles + tracker
   pointer and does not contain the tracker's status-entry text.
7. Identical inputs render a byte-identical brief; `caps.brief_total` behavior and appendix
   overflow are unchanged.

## Tests

- **composition golden file:** the 2026-07-10 writing-assistant findings fixture renders a
  brief matching the prototype's structure (section order, one first action, bundle of 3,
  fold, machine notes).
- **selection rule:** fixtures for each priority-class ordering, severity tie, effort tie,
  id tie.
- **status line:** the four P4 rows plus the crashed-member suffix.
- **bundling:** identical commands merge; near-identical (one byte off) do not; manifest
  lists all ids; cap counts findings not lines.
- **fan-out idempotency:** bundle mark → N rows; re-backfill → 0 new rows; review-then-manual
  and manual-then-review orderings.
- **fallback:** no `next_step` anywhere; `next_step` without `command`; without `effort_min`.
- **determinism:** shuffled findings order in input JSON → byte-identical brief.
