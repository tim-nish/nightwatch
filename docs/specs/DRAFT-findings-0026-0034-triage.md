# DRAFT — Consistency pass & triage: dogfooding findings 0026–0034

- **Status:** APPLIED 2026-07-11 — kept as provenance (precedent:
  [DRAFT-epic-6-amendments](DRAFT-epic-6-amendments.md)). The consistency-pass record
  for the product-lab dogfooding round (0028–0034) plus the two pending init-UX findings
  (0026–0027). After the maintainer's final review pass (generality of the scoping
  model, amendment-ownership check, fixture-independent acceptance criteria — three
  presentation-level fixes applied, no disposition changes), everything below was
  accepted: N1–N3 are folded into `nightwatch.md` (§2.5, §6 safety/status-line, §3/§5
  touchpoints), [content-repo-scoping](content-repo-scoping.md) and the four amendments
  (first-run-ux P9, finding-lifecycle P7, release-journey P4, reconcile-patch-workflow
  P3) are *accepted (folded into nightwatch.md §…)*. **Epics generated** 2026-07-11:
  FR91–FR105, Epic 11 (11.1–11.7) and Epic 12 (12.1–12.7). **Pre-implementation dry-run**
  of the content-repo-scoping model against `QuantScenarioBench` (code class) and
  `writing-assistant` (content class) validated substrate detection, content-class
  product-by-default, and FR101 hygiene, and surfaced
  [finding 0035](../dogfooding/0035-heuristic-candidate-precheck-excludes-product.md): in
  code-class repos, pre-checking *heuristic* candidates re-created the exclude-product
  risk (`spaces/`). **Decision 3** below resolves it; content-repo-scoping P5.2, FR102,
  and Story 12.4 were tightened before publishing.

## Maintainer decisions recorded 2026-07-11

- **Decision 1 (scoping default).** For repositories without an import substrate, tracked
  content is **product by default**. Only narrow convention-based exclusions remain, and
  excluded parents must support re-including product subpaths (e.g.
  `!.claude/commands/**` under an excluded `.claude/**`).
- **Decision 3 (heuristic interview default, 2026-07-11, finding 0035).** In a code-class
  repo the classification interview defaults a *heuristic* candidate **unchecked unless
  dot-prefixed**: dot-dirs (`.github/`, `.devcontainer/`) pre-checked as tooling, non-dot
  dirs (`spaces/`) unchecked as product; convention matches stay pre-checked. A weak
  signal never pre-excludes product.
- **Decision 2 (patch direction).** Mechanical patch support stays **delete-only**.
  Additive or modifying drift remains a human-decision path until repeated dogfooding
  demonstrates a stable, bounded helper contract.

## Triage table

| # | Finding | Disposition | Spec home | Conflicts / overlaps |
|---|---|---|---|---|
| 0026 | Init phase-selection clarity | Amend existing spec (items 1–2); item 3 is a 0012/P8 recurrence → implementation gap, story later | [first-run-ux](first-run-ux.md) **P9** | Item 2's phase-inference signals (release, package, semver) are code-repo-shaped; P9 must state the content-repo fallback to stay consistent with content-repo-scoping |
| 0027 | Dev-tooling directory defaults UX | **Subsumed** — its three asks (pre-selection, scope-terms wording, defaults distinguished visually) become interview clauses of the new spec | [content-repo-scoping](content-repo-scoping.md) **P5** | **Ordering conflict with 0028**: implementing 0027 against the current heuristic would pre-select excluding the product. Must not be specced or built independently |
| 0028 | Content-repo scope inversion | **New spec** (Decision 1 applied) | [content-repo-scoping](content-repo-scoping.md) P1–P6 | Supersedes [analysis-scope](analysis-scope.md) P2/P3 **in part**; absorbs 0027; shares the honest-emptiness principle with 0029; constrains 0026 P9 |
| 0029 | Arch-review no-substrate | Items 1, 2, 5 fold into the new spec (P7 honest emptiness; P8 deferred docs-repo arch mode); items 3–4 (placeholder churn, zero-candidate path) are bounded fixes → stories later | [content-repo-scoping](content-repo-scoping.md) **P7/P8** | Same theme as 0028; no conflicts. Zero-candidate wording also touches `commands/arch-review.md` at implementation |
| 0030 | Severity convention contradiction | Staged core-spec correction + conformance story later | `nightwatch.md` §2.5 — **Amendment N1** below | Touchpoints beyond §2.5: `scripts/lib/types.js:24-25` (the contradicting line), `commands/release-progress.md:53`, [release-journey](release-journey.md) P2's "severity-1 findings" blocker line, `nightwatch.md:708/745`. No conflict with other findings |
| 0031 | State-advance always noops | Staged core-spec correction + bug-fix story later | `nightwatch.md` §6 / `commands/nightwatch.md` step 6 — **Amendment N2** below | Adjacent to [runtime-layout](runtime-layout.md) (cursors location) but amends nothing there — the defect is ordering, not layout |
| 0032 | First-run "seen again tonight" mislabels | Amend existing spec (one proposal) + bug-fix story later | [finding-lifecycle](finding-lifecycle.md) **P7** | Shares the fix area with 0034 item 5 (ledger row semantics) — both land in P7 so the ledger contract lives in one place |
| 0033 | Two roads disagree | Amend existing spec (one proposal) + template-regeneration story later | [release-journey](release-journey.md) **P4** | Boundary held deliberately: matching logic lands in release-journey (data ownership); [brief-roadmap-composition](brief-roadmap-composition.md) stays presentation-only and is **not** amended. Release-journey's existing "journey ↔ brief road consistency" test is the acceptance hook |
| 0034 | Command↔script contract drift + CLI safety | Split by item — see complete disposition below | items 1–3, 5: direct stories (+N3 safety line); item 4: [reconcile-patch-workflow](reconcile-patch-workflow.md) **P3** (Decision 2) | Item 5 merges into finding-lifecycle P7 (with 0032); item 2 is *conformance to* runtime-layout (accepted), not an amendment; item 4 note: reconcile-patch-workflow is still **proposed**, so P3 is an addition to a proposed spec, and its P1 apply-command text needs the same `runtime/out/` path sweep |

## Complete 0034 disposition (per item)

| Item | Content | Disposition | Rationale |
|---|---|---|---|
| 0034.1 | `reconcile.js` (and presumably sibling job CLIs) execute a full run and write `.nightwatch/` into cwd on `--help`/unknown flags — observed writing into the Nightwatch checkout itself | **Direct story** + staged safety line (**Amendment N3**) in `nightwatch.md`'s safety model: job CLIs must print usage and write nothing on `--help`/`-h`/unknown flags | Safety-contract breach with observed evidence; one NFR-grade sentence prevents re-derivation, the rest is implementation |
| 0034.2 | Stale output paths in all four command docs (`.nightwatch/out/` → `.nightwatch/runtime/out/`): `commands/arch-review.md:48,86`, `commands/release-progress.md:29,37,66`, `commands/repo-reconcile.md:30,54,64`, `commands/nightwatch.md:29,228`; also `reconcile-patch-workflow.md` P1's apply-command text | **Direct story** (doc conformance sweep + a test greping command docs for paths `lib/util.outDir` no longer produces) | Conformance to the already-accepted [runtime-layout](runtime-layout.md) spec — no design decision left to make |
| 0034.3 | Member docs demand `CLAUDE_PLUGIN_ROOT`/`NIGHTWATCH_ROOT` else "stop immediately," contradicting orchestrator-supplied NW_ROOT in subagent prompts | **Direct story** (reword script-root resolution in `commands/*.md`: an orchestrator-supplied root satisfies resolution; stop only when no source is available) | Wording fix to an existing contract; no spec owns member launch plumbing and none needs to |
| 0034.4 | Patch harness is delete-only while `repo-reconcile.md:54` claims patches are "the default and only mechanism"; judgment-layer findings additionally have no sanctioned CLI entry path | **Amend [reconcile-patch-workflow](reconcile-patch-workflow.md) (P3)** per **Decision 2**: delete-only is the *designed* mechanical surface; additive/modifying drift routes to human-decision findings that present the proposed text as proposal content, never a hand-built patch file; revisit criterion stated (repeated dogfooding demonstrating a stable, bounded helper contract). The sanctioned findings-append entry path is deferred with it | The spec claim and the shipped surface must agree; Decision 2 resolves the direction (narrow the claim, don't grow the surface) |
| 0034.5 | Reconcile CLI auto-appends a `findings: 0` run row before judgment; the corrected row needs `forced: true`, leaving two same-date run rows | **Merged into [finding-lifecycle](finding-lifecycle.md) P7** (with 0032) + bug-fix story later | Ledger row semantics for judged runs belong where forced-re-run ledger semantics already live; splitting them across two specs would re-create the 0030 problem (one contract, two homes) |

## Staged `nightwatch.md` amendments (applied 2026-07-11)

**N1 — Pin the severity direction (0030).** `nightwatch.md:249` ("1 blocker … 5
nice-to-have"), `commands/release-progress.md:53`, and release-journey P2 already agree
on **1 = worst**; the sole contradicting text is `scripts/lib/types.js:24-25`. Pin, in
§2.5: *"`severity`: integer 1–5, **1 = blocker/worst … 5 = nice-to-have** — this
direction is normative for every producer and consumer."* Conformance fix flips the
types.js JSDoc (not the spec), then `classify()`/sort in `collect-brief.js` are already
correct. Hardening clause (also §2.5): *"Blocker classification keys on
`kind: 'blocker'`; `severity === 1` alone never promotes a finding to blocker"* — and
release-journey P2's blocker line reads "blocker-kind findings by name" instead of
"severity-1 findings by name". Rationale: the endpoint stops being load-bearing, so a
future producer disagreeing about direction can no longer fabricate release blockers.
Add the collector sanity check: a headline claiming blockers while the road says
"Blocking the release: nothing" degrades to the decisions-tier headline plus one
Machine-notes line. (Provenance note: this sanity check refines the FR56 status-line
rule — brief-composition P4, already folded into §6 — so it lands there, not in a
satellite.)

**N2 — Make the state advance immune to its own night (0031).** §6 (and
`commands/nightwatch.md` step 6): *"The state-advancing scheduler call advances cursors
whenever cursors for tonight are unrecorded — the idempotency gate for this call keys on
`state.last_brief_date` **only**, never on the dated brief file, which the same night's
step 4 has always already written."* Acceptance hook: on a fresh repo, the documented
sequence (plan → members → collect-brief → backfill → orchestrate) must leave
`runtime/cursors.json` existing with `arch-review.next_due` 7 days out.

**N3 — Job CLIs never write on unknown invocations (0034.1).** Safety model addition:
*"Every job CLI prints usage and exits without writing on `--help`/`-h`/unknown flags,
and refuses to run when cwd is not a git checkout and no explicit `--repo` was given."*

## Spec-surface summary after this round

- **New:** [content-repo-scoping](content-repo-scoping.md) (proposed) — absorbs 0027,
  0028, 0029(1,2,5); supersedes analysis-scope P2/P3 in part.
- **Amended (proposed sections):** first-run-ux P9 (0026), finding-lifecycle P7
  (0032 + 0034.5), release-journey P4 (0033), reconcile-patch-workflow P3 (0034.4).
- **Staged core corrections:** N1 (0030), N2 (0031), N3 (0034.1) — applied to
  `nightwatch.md` at acceptance.
- **Direct stories only (no spec change):** 0026 item 3, 0029 items 3–4, 0030/0031/0032
  conformance fixes, 0034 items 1–3 and 5.

## Sequencing (unchanged from the pass)

N1 and N2 first (small, restore trust in the brief and cadence for both dogfooding
targets); then content-repo-scoping acceptance (blocks 0027, constrains 0026 P9); then
the four amendments; then the mechanical 0034 stories in any order. Guard: no
0027-derived story may land before content-repo-scoping is accepted.
