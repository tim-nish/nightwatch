# Spec: Release journey — RELEASE.md leads with an ordered road, declared via `milestones:`

- **Status:** accepted 2026-07-11 — **folded into `nightwatch.md`** §2.3, §5, §7,
  refining FR63's section order and extending the `STATE.md` `release:` declaration.
  **FR assignment deferred.** The journey prototype
  ([`RELEASE-2026-07-11.md`](../prototypes/RELEASE-2026-07-11.md)) has **not yet had its
  timed cold read** — its road structure mirrors the MORNING road the maintainer
  validated; the cold read remains a dogfooding acceptance step (harness AC6). **P4
  (single matching authority)** is a second-round addition from finding 0033 — **accepted
  2026-07-11 and folded into `nightwatch.md` §5 (procedure steps 4–5) and §7 (STATE.md
  template)**; implementation pending (see the
  [0026–0034 triage record](DRAFT-findings-0026-0034-triage.md)); it exists because the
  "journey ↔ brief road consistency" test below was violated on the first outside repo.
- **Motivated by:** dogfooding finding
  [0021 — milestone roadmap](../dogfooding/0021-release-md-milestone-roadmap.md); the
  `milestones:` mechanism chosen by the maintainer 2026-07-11 (explicit key; DoD stays
  unordered); P4 by
  [0033 — two roads disagree](../dogfooding/0033-two-roads-disagree.md).
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

## P4 — Single matching authority: one criterion→done map, both roads consume it *(proposed 2026-07-11)*

Observed violation (0033): on product-lab's first night, RELEASE.md marked milestone 1
**✓ done** (the judgment layer fuzzy-matched paraphrased criteria and said so in
`degraded` + a setup finding), while the same night's brief road showed it **"▶ — you
are here"** — the collector's `deriveJourney` re-matched raw criterion text strictly and
found nothing. Two renderers, two matching rules, one declared journey.

**P4.1 — release-progress persists the resolved criterion→done map.** The owning job
records, per criterion, `{criterion, done, evidence, match: exact | resolved}` into its
findings JSON/tracker output. Judgment may still resolve a paraphrase (stating it, as
tonight's run correctly did) — but the *resolution* becomes recorded fact.

**P4.2 — Downstream renderers consume the recorded map, never re-match raw text.**
`deriveJourney` (brief road) takes the persisted map as its `isDone`; the deterministic
collector stays deterministic — it reads recorded facts. The existing "journey ↔ brief
road consistency" test becomes structural: divergence is impossible, not merely tested.

**P4.3 — No map → degrade loudly, never render a wrong mark.** When the map is absent
(release-progress crashed or predates P4) and exact-text matching fails, the road renders
the milestone state as unavailable — *"milestone state unavailable: criteria don't match
`definition_of_done` (see the setup finding)"* — instead of silently showing ▶ at the
wrong milestone.

**P4.4 — Criteria are correct-by-construction at drafting.** Every flow that drafts
`milestones:` (`init`, `init --update`'s offer in P1) copies DoD text **verbatim** into
`criteria`; P1's validation runs at write time, so a paraphrase mismatch is caught at the
one moment a human is present, not by the first night's setup finding.

**P4.5 — The finish line follows the declared target.** The road's terminal line renders
*"🏁 Declare **<target>** done."* by default; the "Tag the release." wording renders only
when a version/tag release check is enabled — an operational target (product-lab's "Q&A
gateway v1 operational") never reads as a shipping ritual. Applies to both RELEASE.md
(P2) and the brief road, which inherit it from the same template text.

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
8. *(P4, proposed)* Any declaration whose milestone criteria are not byte-equal to their
   DoD entries renders the **same** milestone marks in RELEASE.md and the brief road
   (both consume the persisted criterion→done map); with the map removed, the brief road
   degrades to "milestone state unavailable" rather than showing a mark; `init`-drafted
   `criteria` are byte-equal to their DoD entries; a declared non-shipping target renders
   "Declare <target> done." as the finish line. *(Regression fixture: the product-lab
   2026-07-11 replay — RELEASE.md ✓ vs brief ▶ on milestone 1.)*

## Tests

- Declaration parsing: valid block; unmatched reference; unreferenced DoD; absent key.
- Mark derivation matrix: 0/partial/all criteria done per milestone; current/next
  computation.
- Serialization: round-trips from both legacy orders; Notes/human-raw preservation;
  dirty vs untouched paths.
- `init --update` drafting fixture (confirm/decline).
- Journey ↔ brief road consistency: the same fixture renders consistent marks in both
  documents.
