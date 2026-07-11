# Spec: Release journey — RELEASE.md leads with an ordered road, declared via `milestones:`

- **Status:** accepted 2026-07-11 — **folded into `nightwatch.md`** §2.3, §5, §7,
  refining FR63's section order and extending the `STATE.md` `release:` declaration.
  **FR assignment deferred.** The journey prototype
  ([`RELEASE-2026-07-11.md`](../prototypes/RELEASE-2026-07-11.md)) has **not yet had its
  timed cold read** — its road structure mirrors the MORNING road the maintainer
  validated; the cold read remains a dogfooding acceptance step (harness AC6).
- **Motivated by:** dogfooding finding
  [0021 — milestone roadmap](../dogfooding/0021-release-md-milestone-roadmap.md); the
  `milestones:` mechanism chosen by the maintainer 2026-07-11 (explicit key; DoD stays
  unordered).
- **Governed by:** [writing-harness](writing-harness.md) — objective: *goal, current
  milestone, next milestone stateable within 1 minute*; W-rules apply throughout;
  status entries follow harness P6.
- **Scope:** the `release:` declaration's new optional `milestones:` key, RELEASE.md's
  journey block and reader-side section order v2, and milestone marks re-derived every
  run. Tracker interface (§2.7), single-writer rule, item ids, byte-preserved Notes,
  frontmatter, and heading-name parsing are unchanged.

## Problem

RELEASE.md reports percentages and hygiene checks but not the journey: the goal is a
frontmatter field, remaining work is a flat list mixed with generic hygiene at equal
weight, "in progress" is improvised bracket text, and nothing says which milestone comes
next (0021). The structural root: `definition_of_done` is unordered, and per principle 5
an ordering is a human judgment that must be declared, never inferred.

## P1 — The `milestones:` declaration (STATE.md `release:` block)

```yaml
release:
  target: "First release — all planned epics complete"
  definition_of_done:                  # unchanged: unordered criteria, as today
    - "all planned epics complete"
    - "harvest -> draft-article -> review-article works end-to-end"
    - "install and usage documentation validated"
  milestones:                          # NEW, optional: the ordered journey
    - name: "All planned epics complete"
      criteria: ["all planned epics complete"]
    - name: "Writing pipeline proven end-to-end"
      criteria: ["harvest -> draft-article -> review-article works end-to-end"]
    - name: "Install & usage docs validated"
      criteria: ["install and usage documentation validated"]
```

- Each milestone: `name` (required) + `criteria` — exact-text references to
  `definition_of_done` entries. A milestone is **done** when all its referenced criteria
  are done (tracker state); the **current** milestone is the first non-done one; **next**
  is the one after.
- **Validation, declared-not-inferred:** a `criteria` entry matching no DoD item, or a
  DoD item referenced by no milestone, produces one `setup` finding naming the mismatch;
  unreferenced DoD items render under a trailing *"(not yet on the road)"* group so
  nothing silently disappears. Order inside the file is the journey order.
- **Absent `milestones:`** → fully valid (principle 5): no journey markers; the flat
  FR61-style rendering plus a one-line setup nudge ("declare `milestones:` for a
  roadmap"). `init --update` offers to draft the block from the existing DoD list,
  human-confirmed.

## P2 — The journey block (RELEASE.md's first section)

```markdown
## The road

**Goal (yours, declared in STATE.md):** <target verbatim>

- ✓ **<milestone name>** — <one completion clause, evidence-backed>
- ▶ **<milestone name>** — *current milestone.* <remaining criteria as sub-items,
  each per W7/W9: what to change, why, expected outcome> 
- ○ **<milestone name>** — <one orientation clause: what it is, what closing it unlocks (W3)>
- ○ **Hygiene gate before tagging** *(waivable gate — generic checks, not your declaration)*: <failing checks>
- 🏁 **Tag the release.**

**Blocked by:** <severity-1 findings by name, or "nothing">
```

- Marks are **re-derived from criteria state every run** — never stored, so a stale tick
  (the "recorded at 6 epics, plan grew to 8" case) self-corrects whenever the underlying
  criterion's state changes; criterion *evidence* re-verification itself is
  [finding-lifecycle](finding-lifecycle.md) P2 applied to tracker criteria.
- Generic release-checks render only inside the waivable gate (W5), never interleaved
  with declared milestones.
- ✓ ▶ ○ / 🏁 are roadmap marks, visually distinct from feedback checkboxes (W6); the
  brief's road (brief-roadmap-composition P3) renders this same block, compacted.

## P3 — Section order v2 (supersedes FR63's order; parsing unchanged)

```
The road → Next actions (top 3) → Human decisions needed → What changed lately (status
entries, latest first, capped) → Done — evidence appendix → Parked (nice to have) →
Phase → Notes (last)
```

"Human decisions needed" keeps its existing heading and promotion semantics (FR25) —
decisions are their own axis, neither blockers nor remaining work, and render right
after Next actions so a waiting decision is never below history.

- Sections keep heading-name parsing, so files in either prior order read correctly and
  re-serialize into this order on the next rewrite; Notes and human item text stay
  byte-preserved; the not-dirty byte-identical fast path stays.
- "Remaining — implementation/documentation" as *sections* disappear: remaining work
  renders inside its milestone (current → expanded sub-items; later → the milestone's
  orientation clause). The underlying tracker items and their `section` field are
  unchanged — this is serialization only.
- "Status update" is retitled **"What changed lately"** and every entry follows harness
  P6 (impact first: *what changed since yesterday, and does it need you?*).
- Next actions are written per W3/W4: each names the milestone it advances and what
  closing it unlocks.

## Supersession map

| Prior rule | Disposition |
|---|---|
| FR63 section order (Next actions → blockers → decisions → Remaining × 2 → …) | superseded by P3 (road first; Remaining sections fold into milestones; the blockers line lives in the road block; Human decisions needed keeps its own section) |
| FR61 ratio + remaining titles | kept as the no-milestones fallback (brief-roadmap-composition P3) |
| FR26 declared/generic merge, item format, ids, Notes guard | unchanged |
| §5 "append one status line" | superseded by harness P6 (entry contract) |

## Non-goals

- No change to the tracker store interface, item id scheme, evidence structure,
  single-writer rule, or `release_path` resolution.
- No inferred ordering: without `milestones:` there is no journey, only the fallback.
- No weighting/partial credit; a milestone is done iff its criteria are done.

## Acceptance criteria

1. With the P1 declaration, RELEASE.md opens with the road: goal verbatim, ✓ ▶ ○ marks
   derived from criteria state, current milestone expanded with its remaining criteria,
   next and following visible, waivable gate labeled, 🏁 line, W5 blocker line.
2. Marks re-derive every run: completing a fixture criterion flips ▶ → ✓ and advances
   *current* to the next milestone with no stored mark anywhere.
3. Declaration validation: an unmatched `criteria` reference and an unreferenced DoD
   item each produce one setup finding; the unreferenced item renders under
   *"(not yet on the road)"*.
4. Absent `milestones:` → flat fallback + setup nudge; `init --update` proposes a
   drafted block from the DoD list and applies it only on confirmation.
5. Legacy-order files (both pre-FR63 and FR63 orders) parse correctly and re-serialize
   into the P3 order; Notes and human item text byte-identical; untouched documents
   return original bytes.
6. Every "What changed lately" entry opens with impact-on-reader (harness P6), verified
   on change / no-change / regression fixtures.
7. Identical inputs → byte-identical document (NFR8).

## Tests

- Declaration parsing: valid block; unmatched reference; unreferenced DoD; absent key.
- Mark derivation matrix: 0/partial/all criteria done per milestone; current/next
  computation.
- Serialization: round-trips from both legacy orders; Notes/human-raw preservation;
  dirty vs untouched paths.
- `init --update` drafting fixture (confirm/decline).
- Journey ↔ brief road consistency: the same fixture renders consistent marks in both
  documents.
