# DRAFT — Epic 6 spec amendments (dogfooding-driven UX)

- **Status:** APPLIED 2026-07-10 — kept as provenance. Amendments A and B are folded
  into `nightwatch.md` (§2.2, §6, §7); Amendment C (FR37–FR44) is appended to
  `_bmad-output/planning-artifacts/epics.md`; the three source specs are marked
  accepted.
- **Sources:** `docs/specs/first-run-ux.md` (P1–P6), `docs/specs/analysis-scope.md` (P1–P5),
  `docs/specs/interactive-morning-review.md` (P1–P5); findings 0001–0005 in
  `docs/dogfooding/`.
- **How to review:** each amendment below maps to one proposal set and can be struck
  independently. Once you've decided, the accepted amendments get applied to
  `nightwatch.md` and the new FRs appended to
  `_bmad-output/planning-artifacts/epics.md`; the three spec files' status flips from
  *proposed* to *accepted (folded into nightwatch.md §…)*; this draft is then deleted or
  kept as provenance.

## Recommended acceptance decisions

| Proposal | Recommendation | Rationale |
|---|---|---|
| First-run UX P1 (plan display) | **Accept** | Display-only; data already computed by `orchestrate.js --plan` |
| First-run UX P2 (cost/duration estimate) | **Accept** | One line derived from config ceilings |
| First-run UX P3 (stage narration) | **Accept** | Same facts as `run-status-<date>.json`, shown live |
| First-run UX P4 (first-run confirmation gate) | **Accept** | Interactive-only; NFR5 (promptless unattended) preserved |
| First-run UX P5 (`--plan` mode) | **Accept** | Zero-cost; matches existing `--plan` script semantics |
| First-run UX P5 (signals-only `--dry-run` tier) | **Defer** | New execution tier, new surface; revisit after Epic 6 dogfooding |
| First-run UX P6 (scope preview in plan) | **Accept** | Deterministic walk; displays whatever scoping is in effect |
| Analysis scope P1 (two-tier `ignore`/`dev_tooling`) | **Accept** | Names the category the dogfooding run needed |
| Analysis scope P2 (expanded defaults, extend-not-replace) | **Accept** | Fixes both the narrow defaults and the silent-replacement footgun |
| Analysis scope P3 (init detects/confirms dev tooling) | **Accept** | Matches "declared, never inferred" — human confirms at the interactive moment |
| Analysis scope P4 (explicit re-inclusion) | **Accept** | Folded into P2's negation semantics rather than a separate `analyze:` key |
| Analysis scope P5 (brief scope line) | **Accept** | One line; the safety valve for misclassification |
| Interactive review P1–P5 | **Accept** | New front-end to the existing loop; single ledger writer preserved. Strictly selection-based (Acted on / Dismiss / Skip for now) — no typing |

---

## Amendment A — `nightwatch.md` §6: interactive-run presentation & review mode

*Covers first-run UX P1–P6 and interactive review P1–P5.*

### A1. Amend the **Execution order** paragraph (§6) — append:

> **Interactive-run presentation (presentation only — no new scheduling logic; every line
> is derived from `orchestrate.js --plan` output and config):** before launching any member
> subagent, an interactive run prints the plan — due members in order with their
> `budget_tokens`, `effort`, and `timeout_minutes`; skipped members with `next_due`; a
> total token ceiling and bounded duration; and a scope preview (analyzed top-level
> directories with file counts, excluded directories with counts, computed by a
> deterministic walk of the resolved globs at zero model-token cost). While running, each
> lifecycle event — member started, member finished (`ok` / `crashed` / `timeout` /
> `skipped`), brief assembly — is narrated as exactly one line: the same facts recorded in
> `out/run-status-<date>.json`, shown live. `--plan` prints the plan, estimate, and scope
> preview and exits: zero model-token spend, zero writes.
>
> **First-run confirmation gate:** when `.nightwatch/state.json` does not exist *and* the
> session is interactive, the orchestrator asks one yes/no after showing the plan, before
> launching members. Declining stops before any subagent launch and before any write.
> `--force` (or `--yes`) skips the gate. Scheduled/unattended runs never prompt — the
> constrained permission profile (safety rules below) always wins; if the environment
> cannot prompt, proceed. From the second run onward there is no gate. On scheduled runs
> the plan and scope summary are not printed; they land in `out/run-status-<date>.json`
> and the brief's scope line instead.

### A2. Amend the **`init` mode** paragraph (§6) — the dry-run sentence becomes:

> …writes both declaration files from templates; presents the plan, estimate, and scope
> preview and asks the first-run confirmation (this is where most users pay their first
> full budget); runs each job once in dry-run; shows the first brief.

### A3. New paragraph after **Morning feedback loop** (§6):

> **`review` mode (daytime, interactive):** `/nightwatch review [--brief <date>]` walks the
> current brief's unmarked findings in brief order, offering **acted-on** / **dismissed** /
> **skip for now** per finding. Interpretation is the interactive layer's job; writing is
> deterministic: each decision immediately runs
> `scripts/review-feedback.js --id <finding-id> --mark acted-on|dismissed`, which appends
> one feedback row via `recordFeedback()` (the sole sanctioned ledger writer, dated to the
> brief under review) and rewrites the matching checkbox in `MORNING.md` and the dated
> brief, so file state and ledger state never disagree. Already-recorded ids are a stated
> no-op, so review, backfill, and manual checkbox edits compose in any interleaving without
> double-counting. Quitting mid-review loses nothing. Manual checkbox editing remains fully
> supported; the brief's footer (written by `collect-brief.js`) names both methods:
> `Review interactively with /nightwatch review — or mark boxes by hand: [x] acted on, [-] dismissed.`

### A4. Add acceptance criteria to §6's list:

> - [ ] Interactive run prints plan + estimate + scope preview before any subagent
>       launches; `--plan` exits with zero model-token spend and zero writes.
> - [ ] First run (no `state.json`), interactive: declining the gate launches nothing and
>       writes nothing. Scheduled run on the same repo: no prompt, byte-identical behavior
>       to the pre-gate orchestrator.
> - [ ] `review` mode: each decision produces exactly one ledger feedback row and the
>       matching checkbox update; review-then-backfill and backfill-then-review record no
>       duplicates; quitting mid-review preserves recorded decisions.

## Amendment B — `nightwatch.md` §2.2 (+ §7 config template): two-tier scoping

*Covers analysis scope P1–P5.*

### B1. In §2.2 mechanism 2, the `config.yaml` bullet gains scoping semantics:

> Scoping is two-tier: **`ignore`** (never look — build outputs, dependencies, caches,
> `.nightwatch/**`) and **`dev_tooling`** (real repo content that develops the product but
> is not the product — agent workspaces, planning artifacts, prompt/skill directories;
> excluded from all member jobs' analysis). Shipped defaults cover well-known conventions
> for both tiers; user-supplied lists **extend** the defaults rather than replace them,
> with `!pattern` negation to re-include a default-excluded path deliberately. Verification
> is the last line of defense, not a scoping mechanism: excluded trees cost zero
> extraction, judgment, and verification tokens. Exclusions are stated in one brief line,
> never silent.

### B2. `templates/config.yaml` (spec §7) — the `ignore:` line becomes:

```yaml
ignore:                     # never analyzed; extends shipped defaults (use "!pattern" to re-include)
  # defaults: dist/**, build/**, out/**, vendor/**, node_modules/**, .git/**,
  #           coverage/**, **/*.lock, .nightwatch/**
dev_tooling:                # development-only tooling, not product; extends shipped defaults
  # defaults: _bmad/**, _bmad-output/**, .claude/**, .cursor/**, q_a/**
```

*(Exact default lists to be finalized at implementation; criterion: recognizable
development-workspace convention with near-zero chance of being product surface.)*

### B3. §6 `init` mode gains one interview step (before writing declarations):

> …scans the repo root for known dev-tooling conventions plus heuristic candidates
> (top-level git-tracked directories referenced by no product import) and confirms the
> classification with the human; confirmed entries land in `config.yaml` `dev_tooling:` —
> a declaration, visible and versioned, not a hidden default.

### B4. §6 Brief assembly gains one fixed element:

> One scope line per brief:
> `Scope: <n> files analyzed; excluded <dirs with counts> — edit .nightwatch/config.yaml to change.`

### B5. Acceptance criteria (add to §6 or a new §2.2 list):

> - [ ] Fresh run on a fixture repo containing `_bmad/**` and `.claude/**` with no config
>       file: zero extraction/judgment/verification tokens spent on those trees; brief
>       carries the scope line.
> - [ ] A user `ignore:` list extends rather than replaces shipped defaults; `!pattern`
>       re-includes a default-excluded path with exactly one config entry.

## Amendment C — `epics.md` requirements inventory: new FRs

*Append to the Functional Requirements list. Numbering continues from FR36.*

> FR37: Interactive orchestrator runs print the execution plan before launching any member
> subagent — due members in order with per-member `budget_tokens`/`effort`/`timeout_minutes`,
> skipped members with `next_due`, and a total token ceiling with bounded duration — all
> derived from `orchestrate.js --plan` output and config; presentation only, removing it
> changes no scheduling decision.
>
> FR38: The plan includes a scope preview — analyzed top-level directories with file counts
> and excluded directories with counts — computed by a deterministic walk of the resolved
> scoping globs at zero model-token cost; on scheduled runs the same summary is written to
> `out/run-status-<date>.json` and surfaces as the brief's one-line scope statement instead
> of printing.
>
> FR39: Each run lifecycle event — member started, member finished
> (`ok`/`crashed`/`timeout`/`skipped`), brief assembly — is narrated as exactly one line
> during interactive runs, carrying the same facts recorded in `out/run-status-<date>.json`.
>
> FR40: First-run confirmation gate: when `.nightwatch/state.json` is absent and the
> session is interactive, the orchestrator asks one yes/no after the plan and before
> launching members; declining stops before any subagent launch or write; `--force`/`--yes`
> skips; non-interactive runs never prompt (NFR5 wins) and behave byte-identically to the
> ungated orchestrator; no gate from the second run onward.
>
> FR41: `orchestrate` `--plan` mode prints plan, estimate, and scope preview and exits with
> zero model-token spend and zero writes.
>
> FR42: Two-tier analysis scoping: `ignore` (never look) and `dev_tooling` (repo content
> that develops the product but is not the product), both with expanded shipped defaults
> (generated outputs, dependencies, caches, `.nightwatch/**`; agent workspaces and planning
> directories); user lists extend defaults rather than replace them, `!pattern` negation
> re-includes deliberately; excluded trees cost zero extraction/judgment/verification
> tokens; every brief states exclusions in at most one line, never silently.
>
> FR43: `init` detects candidate dev-tooling directories (known conventions plus
> heuristics), confirms the classification with the human, and writes the confirmed set to
> `.nightwatch/config.yaml` `dev_tooling:`; overnight mode never reclassifies.
>
> FR44: `/nightwatch review` (daytime, interactive): walks the current brief's unmarked
> findings in brief order offering acted-on / dismissed / skip-for-now; each decision
> immediately appends one feedback row via `recordFeedback()` and syncs the checkbox in
> `MORNING.md` and the dated brief through a deterministic script
> (`scripts/review-feedback.js`); idempotent with backfill and manual edits in any
> interleaving; the brief footer names both feedback methods.

## Suggested Epic 6 story shape

For `bmad-create-epics-and-stories` / sprint planning, once amendments are applied:

1. **6.1 Two-tier scoping defaults and extend-not-replace config semantics** (FR42) —
   `lib/config.js`, walk filter, fixtures. *First: everything downstream displays or
   confirms this scoping.*
2. **6.2 Scope preview, plan display, and run narration** (FR37, FR38, FR39, FR41) —
   orchestrator command + a small deterministic scope-walk script.
3. **6.3 First-run confirmation gate** (FR40) — orchestrator command; fixture proof that
   scheduled runs are byte-identical.
4. **6.4 `init` dev-tooling detection and confirmation** (FR43) — `init.js` + interview.
5. **6.5 Interactive morning review** (FR44) — `review-feedback.js` + command mode +
   brief footer via `collect-brief.js`.

## Not in this draft (explicitly deferred)

- Signals-only `--dry-run` execution tier (first-run-ux P5, second half).
- Inferring "acted on" from git history (named non-goal in the review spec).
