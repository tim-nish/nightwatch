# Nightwatch — specification

**Nightwatch is a portable Claude Code plugin for unattended overnight repository
review.** Installed into any repository, it runs three read-mostly jobs on a schedule —
consistency reconciliation, architecture review, and release-progress tracking — and
compresses their output into one capped, ranked morning brief. It never writes code,
never pushes, and never publishes; its deliverables are findings, patches-as-proposals,
and a maintained `RELEASE.md`.

This document is the complete, implementation-ready specification: architecture,
the four command specs, file formats, templates, build order, acceptance criteria,
and safety rules.

---

## 1. Design principles

These follow from what "unattended overnight" means, and every spec below is derived
from them:

1. **No mid-run judgment is available.** A human decision that's needed partway
   through either blocks or gets guessed. Therefore jobs are read-mostly analysis
   producing *proposals*, plus mechanical changes a machine can fully verify. Feature
   implementation and refactoring are permanently out of scope.
2. **The bottleneck is morning attention, not tokens.** Every job's real deliverable
   is a capped, ranked brief entry with an evidence pointer. Overflow goes to an
   appendix nobody is expected to read. An unread report is negative value: it costs
   attention and trains the user to ignore the system.
3. **Trust is the asset.** Judgment findings pass an adversarial verify step before
   reaching the brief, and a standing demotion rule applies: a job whose findings the
   user ignores two consecutive runs is flagged for retirement or redesign in the
   next brief.
4. **Deterministic work goes in scripts; judgment work goes in agent prompts.**
   Scripts (single-file Node CLIs, `js-yaml` as the only dependency) extract signals,
   enforce caps, and assemble output — they cannot hallucinate. Agents interpret
   signals, argue verdicts, and write prose.
5. **Anything a human must decide is declared, never inferred.** Source-of-truth
   precedence, the definition of "release-ready", layering rules, and project phase
   are read from repo-local declaration files. Undeclared → the dependent check is
   skipped and surfaced as a one-line setup finding. This rule is what makes the
   plugin honest on repositories it knows nothing about.

---

## 2. Architecture

### 2.1 Packaging

One Claude Code plugin, `nightwatch`, providing four commands:

| Command | Role | Default cadence |
|---|---|---|
| `/repo-reconcile` | spec ↔ docs ↔ code consistency | nightly |
| `/arch-review` | architecture drift & overengineering review | weekly |
| `/release-progress` | maintain the path-to-release tracker | nightly |
| `/nightwatch` | orchestrator: run what's due, emit one brief | nightly (the scheduled entrypoint) |

Plus `/nightwatch init` — a daytime, interactive setup mode that drafts the two
repo-local files below with the human present. Overnight runs never create or edit
declaration files.

### 2.2 Genericity mechanisms

The same plugin build must work, unmodified, on any repository. Three mechanisms
carry that guarantee:

1. **No hardcoded paths.** Plugin-internal paths resolve through
   `${CLAUDE_PLUGIN_ROOT}` (provided by the harness at runtime). Repo-side paths are
   either the repo root the session runs in, or declared in local config. Scripts are
   invoked as `node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.js --repo .`.
2. **Two repo-local files carry everything repo-specific.** Both optional; every
   command runs with neither and degrades gracefully (§2.5):
   - **`STATE.md`** (repo root, human-authored, machine-read): declarations no tool
     can infer — source-of-truth precedence per area, current phase, release target
     and definition of done, optional layering rules. Free prose plus exactly one
     fenced ` ```yaml ` block that tooling parses; prose outside the block is ignored
     by machines. Lives at root deliberately: it's a contract with humans too.
   - **`.nightwatch/config.yaml`** (operational config, all keys optional): budgets,
     caps, cadences, ignore globs, extractor selection. Defaults ship in the plugin;
     an absent or empty file is valid.
3. **Pluggable deterministic extractors with a universal fallback.** Surface and
   architecture signals need language awareness. Extractors ship per ecosystem
   (Node/TS and Python first), selected by lockfile/manifest detection
   (`extractors: auto`). When none matches, jobs fall back to signals that exist in
   every repository: git history (churn, co-change coupling, hotspots), file-tree
   shape and size trends, README/docs claims, and TODO/FIXME density. Degradation is
   always stated in the brief, never silent.

### 2.3 The unavoidable repo-specific assumptions — named

Four things genuinely cannot be inferred by any implementation:

| Assumption | Why inference is forbidden | Mechanism |
|---|---|---|
| Which artifact is authoritative per area | Guessing wrong silently corrupts the repo's truth | `STATE.md` `authority:`; absent → reconcile still detects conflicts but omits direction-of-fix, and its finding #1 is "declare authority" |
| What "release-ready" means | Definition of done is a product judgment | `STATE.md` `release:`; absent → generic hygiene checklist only, tracker labeled "generic criteria" |
| Layering rules | Directory layout ≠ intended architecture | `layers:` in config; absent → layering checks skipped, reported as not-configured |
| Current phase | Changes ranking (overengineering matters more pre-release; drift more after) | `phase:` in `STATE.md`; absent → neutral ranking |

Uniform pattern (principle 5): declared, or skipped-and-surfaced. `/nightwatch init`
makes the declarations cost ten minutes once.

### 2.4 Directory structures

**This repository (the plugin):**

```
night-watch/
  .claude-plugin/plugin.json        # name, version, command manifest
  commands/
    nightwatch.md                   # orchestrator (also handles `init`)
    repo-reconcile.md
    arch-review.md
    release-progress.md
  scripts/                          # Node, js-yaml only, all take --repo
    lib/config.js                   # defaults ← .nightwatch/config.yaml ← STATE.md yaml block
    lib/findings.js                 # findings schema, ledger append, dedupe
    git-signals.js                  # churn, co-change, hotspots (universal)
    surface-inventory.js            # public surface: CLI/flags/exports/commands
    arch-signals.js                 # speculation/duplication/layering signals
    release-checks.js               # deterministic release-hygiene checks
    collect-brief.js                # assemble brief, enforce caps, write MORNING.md
  templates/
    STATE.md  config.yaml  RELEASE.md
  docs/install.md
  test/fixtures/                    # one fixture repo per acceptance criterion
```

**A host repo after install + first runs (total footprint):**

```
STATE.md                            # human declarations (drafted by /nightwatch init)
RELEASE.md                          # maintained by /release-progress
.nightwatch/
  config.yaml                       # optional operational config
  MORNING.md                        # stable path: latest brief (open this)
  briefs/2026-07-08.md              # dated briefs (committed — they're memory)
  ledger.jsonl                      # every finding ever, with acted-on/dismissed marks
  state.json                        # cadence cursors, last-run dates
  out/                              # transient per-run JSON + patch files (gitignored)
```

**Cross-repo coupling: none.** Each installation is self-contained. Multi-repo
aggregation is explicitly not this plugin's job; a portfolio view would be a separate
consumer that reads each repo's `MORNING.md`.

### 2.5 Shared findings contract

Every job emits `.nightwatch/out/<job>-<date>.json` conforming to one schema. This is
the inter-command interface: `release-progress` consumes the other jobs' findings
through it, and the brief collector consumes all three. Jobs are therefore loosely
coupled — any job runs standalone, and a partial night degrades cleanly.

```json
{ "job": "repo-reconcile", "date": "2026-07-08",
  "degraded": ["no STATE.md authority block"],
  "findings": [ {
    "id": "RC-0031",              
    "kind": "drift|arch|blocker|decision|setup|info",
    "severity": 1,
    "title": "README documents --tag flag removed from CLI",
    "evidence": [{"path": "README.md", "line": 41}, {"path": "src/cli.ts", "line": 12}],
    "action": "patch-available|human-decision|daytime-task",
    "verified": true
} ] }
```

- `id` is stable across runs (content-hash of locus + kind) — this is what makes
  ledger dedupe, recurrence counting, and acted-on/dismissed tracking work.
- `severity`: 1 blocker … 5 nice-to-have.
- `verified`: survived the adversarial pass; only verified findings enter the brief.

---

## 3. `/repo-reconcile` — specification

**Purpose:** detect inconsistencies between specs, README, documentation, and
implementation. Report disagreements, and the *direction* of fix when — and only
when — the repo has declared precedence. Never infer authority.

**Config read:** `STATE.md` (`authority`, `phase`), config (`caps.reconcile` default
10, `budget_tokens`, `ignore`, `patch_branch`).

**The `STATE.md` authority declaration** (yaml block; area names are free-form):

```yaml
authority:
  architecture: {artifact: "docs/ARCHITECTURE.md", role: authoritative}
  behavior:     {artifact: "specs/*.md",           role: authoritative, rule: newest-accepted-wins}
  usage:        {artifact: "README.md",            role: derived}   # follows code, never leads it
```

Semantics: `role: authoritative` — code and docs should conform to it; a conflict is
a bug or an unrecorded decision, always a `human-decision` finding. `role: derived` —
it must follow the implementation; a conflict is mechanically fixable,
`patch-available`.

**Deterministic layer** — `surface-inventory.js` extracts the repo's *claimable
surface*: CLI subcommands and flags (help-text or entrypoint parse), exported
symbols, command/skill files, config keys read by code, file-tree shape. Extractor
per ecosystem plus the universal fallback (file tree + command files + README code
blocks). Output: `out/surface-<date>.json`.

**Judgment layer:**

1. Load the authority block. Absent → emit a single `setup` finding ("declare
   authority in STATE.md; run `/nightwatch init`"), then continue in
   **detection-only mode**: conflicts still reported, direction-of-fix omitted.
2. Extract testable claims from README, docs, and specs: commands that should exist,
   flags, behaviors, architecture assertions ("X never writes to Y").
3. Verify each claim against the surface inventory plus targeted code reads.
   Verdict per claim: `holds` / `drifted` / `unverifiable-statically` (needs a live
   run — listed for a daytime check, never guessed).
4. Adversarial pass: a second subagent attempts to refute each `drifted` verdict;
   only survivors reach the brief.
5. For drifted claims in `derived` artifacts: generate a unified-diff **patch file**
   at `out/reconcile-<date>.patch`. Patch files are the default and only mechanism;
   if `patch_branch: true`, additionally apply the patch on branch
   `nightwatch/reconcile/<date>` created in a **temporary worktree** — the user's
   working tree and checked-out branch are never touched. For drifted claims
   involving an `authoritative` artifact: `human-decision`, and no patch is ever
   drafted in either direction.

**Outputs:** findings JSON; brief section ≤ `caps.reconcile`, ranked by user-facing
severity (a documented-but-nonexistent command outranks a stale internal comment);
patch file when applicable; an explicit "Human decisions required" subsection.

**Safety rules (normative):**
- Never edits any repo file in place.
- Patches only for artifacts declared `derived`.
- Never resolves an authoritative-vs-code conflict in either direction.
- A broken build / unparsable surface is finding #1 and stops deeper checks — a
  broken build outranks all drift.

**Failure handling:** authority glob matches nothing → `setup` finding naming the
dead pointer; docs directory absent → claims sourced from README only, noticed in
`degraded`.

**Acceptance criteria:**
- [ ] Fixture: README documents a flag the CLI lacks, README declared `derived` →
      finding with both evidence pointers, and applying the emitted patch fixes it.
- [ ] Same fixture with README declared `authoritative` → `human-decision`, no patch.
- [ ] No `STATE.md` → conflicts still detected; every finding lacks direction-of-fix;
      finding #1 is the setup finding.
- [ ] `patch_branch: true` → branch exists with exactly the patch commit; the user's
      checked-out branch and working tree are byte-identical to before the run.
- [ ] Clean fixture → "0 findings" one-liner, nothing else.

**Tests:** claim extraction (code blocks, flag tables, prose commands); patch
idempotency (re-run after apply → 0 findings); authority parser edge cases (missing
keys, dead globs); id stability across runs.

---

## 4. `/arch-review` — specification

**Purpose:** review the host repo's architecture for drift, unnecessary abstraction,
duplicated responsibility, hidden coupling, layering violations, and overengineering.
Proposals only; code is never modified.

**Config read:** `STATE.md` (`phase`, `authority.architecture`), config (`layers`,
`ignore`, `extractors`, `caps.arch_candidates` default 7, `budget_tokens`).

**Deterministic layer** — `arch-signals.js` (+ `git-signals.js`), emits
`out/arch-signals-<date>.json`:

- *Speculation:* interfaces/protocols/ABCs with exactly one implementation;
  indirection with exactly one caller; config keys read nowhere; flags/options
  untouched > 60 days. (Extractor-dependent; skipped with notice when degraded.)
- *Duplication:* near-duplicate names/signatures across modules; heavy import-set
  overlap between modules.
- *Hidden coupling:* files co-changing in > N commits across module boundaries —
  pure git, always available.
- *Layering:* dependency edges violating declared `layers:` rules. Only when declared.
- *Growth:* size and churn trends; hotspots with high churn and zero mentions in the
  declared architecture document (only when `authority.architecture` exists).

**Judgment layer** — for each signal, the agent:

1. Reads the declared architecture authority doc if any; an abstraction that document
   mandates is `keep` even at one implementation — cited, not argued around. This
   context is exactly what pure metrics miss.
2. Argues **both sides** ("earns its keep because… / speculative because…") before a
   verdict: `keep` / `simplification-candidate` / `decision-needed`.
3. Attaches an estimated blast radius to each candidate (files, tests, public surface
   touched) so the morning reader can size the work at a glance.
4. Adversarial pass: a second subagent attempts to refute each candidate; only
   survivors are `verified: true`.
5. Ranks phase-aware: `phase: prototype|building` weights overengineering up;
   `phase: released` weights drift and coupling up; no phase → neutral.

**Outputs:** findings JSON; brief section ≤ `caps.arch_candidates`, ranked, each with
evidence pointers and blast radius; overflow to an appendix (ids only).

**Safety rules (normative):** writes nothing outside `.nightwatch/`; never proposes
removing anything the architecture authority names as intentional without flagging
the relevant section; no overnight follow-up implementation — executing a
simplification is a daytime session. Unparsable source is reported and skipped, never
"fixed".

**Failure handling:** no extractor for the language → git-only signals plus
`degraded` notice; shallow git history (< 20 commits) → co-change checks skipped with
notice; budget exhausted → partial output labeled partial.

**Acceptance criteria:**
- [ ] Fixture with a one-implementation interface *with* an authority-doc mandate and
      one *without*: first → `keep` citing the doc; second → candidate.
- [ ] Two modules co-changing in 8 commits → hidden-coupling finding from git data
      alone, in a language with no extractor.
- [ ] Declared `layers:` violated by one import → layering finding with both file
      pointers; same fixture without `layers:` → no finding, one not-configured
      notice.
- [ ] Fresh zero-config repo → valid (possibly near-empty) report, zero writes
      outside `.nightwatch/`.
- [ ] Unchanged repo, two runs → identical finding ids; recurrence counted in the
      ledger, nothing re-reported as new.

**Tests:** one fixture per signal class; adversarial-pass survival asserted on a
known-good and a known-refutable candidate; determinism (shuffled file order →
identical signals JSON).

---

## 5. `/release-progress` — specification

**Purpose:** maintain a living tracker of the distance to public release, so "what's
done / what remains / what's next / how close" survives between sessions without
human bookkeeping.

**Path and format: `RELEASE.md` at repo root.** Root, not hidden in `.nightwatch/`,
because it's the repo's answer to "how close is this?" for humans and future
collaborators. Markdown with YAML frontmatter for machine fields, fixed section
headings, stable item ids, and one human-owned section the machine never touches:

```markdown
---
phase: hardening            # mirrors STATE.md
target: "v0.1 public release"
progress: 64                # % of definition-of-done + blockers resolved (derived)
updated: 2026-07-08
---
# Release progress

## Status update (latest first, capped at 10 entries)
- 2026-07-08 — reconcile idempotency done (RP-011 ✓); new blocker RP-019 (broken quickstart link)

## Phase
## Done                       <!-- completed work, each item with evidence link -->
## Remaining — implementation
## Remaining — documentation
## Release blockers
## Human decisions needed
## Nice to have
## Next actions (top 3)
## Notes (human-owned — never machine-edited)
```

Item format: `- [ ] RP-014 — <title> (evidence: path:line | spec §)`. Ids are stable;
completed items move to **Done** with their closing evidence rather than being
deleted.

**Where "done" comes from — two sources, kept distinct:**

1. **Declared:** the `STATE.md` `release:` block — `target:` plus
   `definition_of_done:` (human judgment, e.g. "quickstart reproduces in 15 min on a
   fresh clone"). Absent → source 2 only, and the tracker header says *"generic
   criteria — declare `release:` in STATE.md for a real definition of done"*.
2. **Generic:** `release-checks.js`, deterministic hygiene checks valid for any
   public repo: LICENSE present; README has install + quickstart sections; CI config
   exists (and last test run passes, if cheaply runnable); no committed-secret
   patterns; TODO/FIXME count under threshold; version/tag consistency; CHANGELOG
   presence. Configurable via `release_checks.disable`.

**Procedure (judgment layer):**

1. Run `release-checks.js`; read the `release:` block; read the current `RELEASE.md`
   (or instantiate from the template on first run); read tonight's reconcile and
   arch-review findings JSON **if present** — the command is fully functional
   standalone.
2. Reconcile the document against reality: check off items whose evidence now exists
   (recording the evidence link); add newly discovered items; promote
   `human-decision` findings into **Human decisions needed** and severity-1 findings
   into **Release blockers** — cross-referenced by finding id, so they clear
   automatically when the source finding clears.
3. Never delete an item it didn't create; a human-added item that appears obsolete is
   tagged `(stale? — confirm)` instead.
4. Recompute `progress:` (fraction of definition-of-done items plus blockers
   resolved — a coarse honest number, not a promise); refresh **Next actions** (top
   3, each pointing at a specific file or spec); prepend one status-update line.
5. Emit a ≤ 12-line brief section: progress delta since last run, new blockers, new
   decisions, next actions.

**Safety rules (normative):** the only repo file it writes is `RELEASE.md`; the
**Notes** section and human-authored item text are byte-preserved; it summarizes
distance-to-release but never *redefines* the target — target changes are human edits
to `STATE.md`.

**Failure handling:** malformed `RELEASE.md` (hand-edit broke the structure) → the
run writes nothing, emits a `setup` finding pointing at the parse error, and the
brief carries last night's snapshot with a staleness notice.

**Acceptance criteria:**
- [ ] Fresh repo, no `STATE.md` → valid `RELEASE.md` from generic checks, header
      carries the generic-criteria notice.
- [ ] Add a `release:` block → next run merges declared items without duplicating
      generic ones; existing ids unchanged.
- [ ] Complete an item (make its evidence real) → item checks off with evidence link,
      `progress` increases, status line records it.
- [ ] Hand-add an item and a Notes paragraph → both survive 5 consecutive runs
      byte-identical (aside from legitimate state changes).
- [ ] Reconcile emits a severity-1 finding → it appears under Release blockers the
      same night, and moves to Done the night after the fix lands.
- [ ] No-change night → only `updated:` and one "no change" status line differ.

**Tests:** document round-trip (parse → serialize → byte-identical); id stability
under retitling; progress arithmetic; merge behavior when both sources express the
same criterion.

---

## 6. `/nightwatch` — orchestrator specification

**Purpose:** the single scheduled entrypoint. Runs what's due, in dependency order,
unattended; emits one capped, ranked morning brief; survives any member job failing.

**Execution order:** `repo-reconcile` → `arch-review` (only if due per cadence) →
`release-progress` (last, so it consumes tonight's findings) → `collect-brief.js`.
Each member runs as an independent subagent with its `budget_tokens` and `effort`
from config. A crash or budget exhaustion is recorded as one brief line and **never
blocks the remaining jobs** — the findings-file contract means `release-progress`
runs on whatever JSON exists, so partial nights degrade cleanly.

**`init` mode (daytime, interactive — the one mode that may ask questions):** detects
missing `STATE.md` / config; interviews the human (authority per area, phase, release
target and definition of done, optional layers); writes both files from templates;
runs each job once in dry-run; shows the first brief. Overnight mode never creates or
edits declaration files.

**Brief assembly** (`collect-brief.js` — deterministic, because truncation must be
mechanical; ranking *within* jobs is the jobs' judgment):

- Fixed section order: release-progress delta → human decisions (merged across jobs)
  → reconcile findings → arch candidates → failures & degraded notices → appendix
  pointer.
- Global cap `caps.brief_total` (default 25). Interleave priority when over cap:
  blockers > human decisions > drift > arch > nice-to-have.
- Writes `briefs/<date>.md`, overwrites `MORNING.md`, appends per-job ledger lines
  (date, job, tokens, findings count, degraded flags).

**Morning feedback loop:** brief items render as checkboxes (`acted-on` /
`dismissed`); the next run backfills the marks into `ledger.jsonl`. The demotion rule
(principle 3) is computed here: a member job with zero acted-on findings for two
consecutive runs is flagged for retirement or redesign in the next brief — the system
proposes pruning itself.

**Safety rules (normative — these bind every member job; the orchestrator enforces
them by contract and its prompt restates them):**

- Never implements features; never refactors; never modifies source code.
- Write surface, exhaustively: `.nightwatch/**`, `RELEASE.md`, patch files under
  `out/`, and (opt-in) `nightwatch/*` branches via temporary worktree. Nothing else,
  ever — never the user's current branch or working tree.
- Never pushes, never creates PRs or issues, never posts externally; no network.
- Idempotent per date: a second same-night invocation sees `state.json` plus the
  dated brief and exits without re-spending tokens (`--force` to override).
- Runs under a constrained permission profile in which prompts are impossible, not
  rare — unattended is precisely when a prompt cannot be answered.

**Failure handling:** repo is not a git checkout → abort with a one-line stub brief;
member job exceeds `timeout_minutes` → killed, noted, next job proceeds; the brief
collector itself fails → raw findings JSON remains in `out/` and a stub brief names
the failure. No brief at all is itself a signal; the collector always attempts a stub.

**Acceptance criteria:**
- [ ] One member job deliberately crashing → brief contains the other jobs' sections
      plus a one-line failure notice; orchestrator exits success.
- [ ] Second run the same night → no token spend, no file changes.
- [ ] 60 synthetic findings across jobs → brief holds exactly `caps.brief_total`,
      interleaved by priority class, appendix lists the remainder by id.
- [ ] Full run on a repo with no config and no `STATE.md` → valid brief whose top
      items are the setup findings; zero writes outside the declared write surface
      (asserted by `git status` plus a filesystem snapshot diff).
- [ ] After 3 simulated nights, the ledger answers the demotion query mechanically.

---

## 7. Templates (shipped in `templates/`)

**`STATE.md`** — prose header explaining the file, plus the single parsed block:

```yaml
authority:
  architecture: {artifact: "docs/ARCHITECTURE.md", role: authoritative}
  behavior:     {artifact: "specs/*.md", role: authoritative, rule: newest-accepted-wins}
  usage:        {artifact: "README.md", role: derived}
phase: prototype            # prototype | building | hardening | released
release:
  target: "v0.1 public release"
  definition_of_done:
    - "quickstart reproduces on a fresh clone in 15 minutes"
    - "all commands have specs and the reconciler reports 0 drift"
```

**`config.yaml`** — every key optional; defaults shown are the shipped defaults:

```yaml
cadence:  {repo-reconcile: nightly, arch-review: weekly, release-progress: nightly}
budget_tokens: {repo-reconcile: 200000, arch-review: 300000, release-progress: 100000}
effort:   {repo-reconcile: medium, arch-review: high, release-progress: medium}
caps:     {brief_total: 25, reconcile: 10, arch_candidates: 7}
ignore:   ["dist/**", "vendor/**", "node_modules/**"]
extractors: auto            # or a list, e.g. [node, python]
layers: []                  # e.g. [{name: core, path: "src/core/**", may_depend_on: []}]
release_checks: {disable: []}
patch_branch: false         # true → also apply derived-doc patches on nightwatch/* branches
timeout_minutes: 30
```

**`RELEASE.md`** — the §5 skeleton with empty sections and the Notes guard comment.

---

## 8. Build order

1. **Plugin skeleton + `lib/config.js` + `lib/findings.js`.** Manifest; config
   precedence (shipped defaults ← `config.yaml` ← `STATE.md` yaml block); findings
   schema, stable-id hashing, ledger append. Everything depends on these.
2. **`/release-progress`.** First shippable value: needs only `release-checks.js`
   and the document round-trip — no extractors — and it most directly attacks the
   losing-track problem. Dogfood standalone for a few days.
3. **`/repo-reconcile`.** `surface-inventory.js` with the Node extractor plus the
   universal fallback; authority semantics; patch emission.
4. **`/nightwatch`.** Orchestrator over the two nightly jobs, `init`, brief
   collector, ledger. Schedule it and start the trust ramp.
5. **`/arch-review`.** Heaviest judgment load and weekly anyway; it joins a system
   that has already earned morning attention.

### The portability gate — every increment must pass this before merging

Install the plugin into a **fresh, unrelated fixture repo** — no `STATE.md`, no
config, a language without an extractor — and run `/nightwatch`. Required result: a
valid brief whose top findings are the setup declarations, zero guessed authority,
zero writes outside the declared write surface, clean exit. Then run the identical
build against 2–3 real repositories that differ only in their local
`STATE.md`/`config.yaml`. If any of them needs a plugin-side change, that change must
be a new config key or a new extractor — never a special case naming a repository.
