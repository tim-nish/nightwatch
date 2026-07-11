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
   Scripts (single-file Node CLIs, `js-yaml` as the only runtime dependency) extract
   signals, enforce caps, and assemble output — they cannot hallucinate. Agents
   interpret signals, argue verdicts, and write prose.
5. **Anything a human must decide is declared, never inferred.** Source-of-truth
   precedence, the definition of "release-ready", layering rules, and project phase
   are read from repo-local declaration files. Undeclared → the dependent check is
   skipped and surfaced as a one-line setup finding. This rule is what makes the
   plugin honest on repositories it knows nothing about.
6. **Never reimplement a mature analyzer.** Nightwatch's durable value is the
   judgment layer: interpreting signals, ranking, adversarial verification, and the
   brief. Deterministic *analysis* — dependency graphs, layering enforcement,
   dead-code detection — is delegated to established, actively maintained ecosystem
   tools through the extractor adapter contract (§2.6). Custom deterministic code is
   limited to three categories: (a) universal signals every repository has (git
   history, file tree); (b) normalization glue that maps tool output onto the shared
   signals schema; (c) checks with no mature open-source equivalent (claimable-surface
   inventory, release-hygiene checks, brief assembly).

---

## 2. Architecture

### 2.1 Packaging and distribution

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

**Dual distribution modes (normative).** The same build must work both ways, with no
file differences between them:

1. **Plugin mode** — the directory is registered as a Claude Code plugin (via
   `--plugin-dir`, a local/private marketplace, or a published one). The harness sets
   `${CLAUDE_PLUGIN_ROOT}` for every command run.
2. **Standalone-command mode** — the `commands/*.md` files are symlinked or copied
   into a Claude Code commands directory (`~/.claude/commands/` or a project-local
   `.claude/commands/`), and the user sets `${NIGHTWATCH_ROOT}` to the checkout.

Two rules keep the modes interchangeable:

- **Single script-root resolution.** Every path to a plugin-internal file (script,
  template, adapter) resolves through one chain: `${CLAUDE_PLUGIN_ROOT}` →
  `${NIGHTWATCH_ROOT}` → refuse to run with a one-line setup message. No hardcoded
  paths, no guessing. Scripts are invoked as
  `node <root>/scripts/<name>.js --repo .`.
- **Self-contained command files.** `commands/*.md` use only the markdown+frontmatter
  format valid in both plugin and user-command contexts, and never assume a
  particular install location or working directory beyond "the session runs in the
  host repo root". Command names are stable across modes (they are part of the user's
  muscle memory and of any scheduled invocations).

### 2.2 Genericity mechanisms

The same plugin build must work, unmodified, on any repository. Three mechanisms
carry that guarantee:

1. **No hardcoded paths.** The §2.1 resolution chain for plugin-internal paths;
   repo-side paths are either the repo root the session runs in, or declared in local
   config.
2. **Two repo-local files carry everything repo-specific.** Both optional; every
   command runs with neither and degrades gracefully (§2.5):
   - **`.nightwatch/STATE.md`** (human-authored, machine-read): declarations no tool
     can infer — source-of-truth precedence per area, current phase, release target
     and definition of done, optional layering rules. Free prose plus exactly one
     fenced ` ```yaml ` block that tooling parses; prose outside the block is ignored
     by machines. Lives beside `config.yaml` under `.nightwatch/` so Nightwatch keeps a
     single home in the repo (§2.4); a legacy root `STATE.md` is still read for
     backward compatibility until `init` migrates it.
   - **`.nightwatch/config.yaml`** (operational config, all keys optional): budgets,
     caps, cadences, scoping globs, extractor selection, tracking backend. Defaults
     ship in the plugin; an absent or empty file is valid. Scoping is two-tier:
     **`ignore`** (never look — build outputs, dependencies, caches, `.nightwatch/**`)
     and **`dev_tooling`** (real repo content that develops the product but is not
     the product — agent workspaces, planning artifacts, prompt/skill directories;
     excluded from all member jobs' analysis). Shipped defaults cover well-known
     conventions for both tiers; user-supplied lists **extend** the defaults rather
     than replace them, with `!pattern` negation to re-include a default-excluded
     path deliberately. **Negation is match-based** (gitignore-style precedence: the
     most specific matching pattern wins, a tie goes to the negation), so a subpath of
     an excluded parent is re-includable with one entry — e.g. the shipped default
     `!.claude/commands/**` keeps agent commands (behavior, not workspace) in scope
     under an excluded `.claude/**`. **Product scope is substrate-aware** (spec:
     `docs/specs/content-repo-scoping.md`): when no extractor detects an import
     substrate, every tracked top-level directory is **product by default** — only
     narrow convention exclusions apply, and the "referenced by no product import"
     heuristic is disabled as vacuous; declarations always win over either default
     profile. Shipped-default membership carries a stated criterion (recognizable
     dev-workspace convention, near-zero chance of being product surface — `q_a/**`
     failed it and is not a default). Verification is the last line of defense, not a
     scoping mechanism: excluded trees cost zero extraction, judgment, and verification
     tokens. Exclusions are stated in one brief line, never silent — and when an
     exclusion empties a signal source a member job consumes (command files, specs, doc
     claims, import graph), that job's `degraded` list names both the glob and the
     consequence, so a scope-caused empty result can never read as a clean verdict.
3. **Extractor adapters with a universal fallback (§2.6).** Language-aware signals
   come from mature ecosystem analyzers wrapped in thin adapters, selected by
   lockfile/manifest detection (`extractors: auto`). When no adapter matches — or its
   backing tool isn't installed — jobs fall back to signals that exist in every
   repository: git history (churn, co-change coupling, hotspots), file-tree shape and
   size trends, README/docs claims, and TODO/FIXME density. Degradation is always
   stated in the brief, never silent.

### 2.3 The unavoidable repo-specific assumptions — named

Four things genuinely cannot be inferred by any implementation:

| Assumption | Why inference is forbidden | Mechanism |
|---|---|---|
| Which artifact is authoritative per area | Guessing wrong silently corrupts the repo's truth | `STATE.md` `authority:`; absent → reconcile still detects conflicts but omits direction-of-fix, and its finding #1 is "declare authority" |
| What "release-ready" means | Definition of done is a product judgment | `STATE.md` `release:` (`definition_of_done`, plus optional ordered `milestones:` referencing DoD items — the journey order is declared, never inferred); absent → generic hygiene checklist only, tracker labeled "generic criteria"; DoD without `milestones:` → flat rendering + one setup nudge |
| Layering rules | Directory layout ≠ intended architecture | `layers:` in config; absent → layering checks skipped, reported as not-configured |
| Current phase | Changes ranking (overengineering matters more pre-release; drift more after) | `phase:` in `STATE.md`; absent → neutral ranking |

Uniform pattern (principle 5): declared, or skipped-and-surfaced. `/nightwatch init`
makes the declarations cost ten minutes once.

### 2.4 Directory structures

**This repository (the plugin):**

```
nightwatch/
  .claude-plugin/plugin.json        # name, version, command manifest
  commands/
    nightwatch.md                   # orchestrator (also handles `init`)
    repo-reconcile.md
    arch-review.md
    release-progress.md
  scripts/                          # Node CLIs; js-yaml is the only runtime dep
    lib/types.js                    # JSDoc typedefs: findings, signals, tracker items
    lib/config.js                   # defaults ← .nightwatch/config.yaml ← STATE.md yaml block
    lib/findings.js                 # findings schema helpers, stable-id hashing, dedupe
    lib/signals.js                  # normalized signals schema helpers + merge
    lib/tracker.js                  # tracking-store interface + markdown backend (§2.7)
    extractors/                     # adapter per analyzer (§2.6)
      universal-git.js              # churn, co-change, hotspots, growth (always available)
      node-depcruise.js             # wraps dependency-cruiser (Node/TS)
      python-importlinter.js        # wraps import-linter (Python)
    git-signals.js                  # CLI over universal-git
    surface-inventory.js            # public surface: CLI/flags/exports/commands (custom — no mature equivalent)
    extract-signals.js              # extractor runner: detect → probe → run adapters → merged signals JSON
    release-checks.js               # deterministic release-hygiene checks (custom — no mature equivalent)
    collect-brief.js                # assemble brief, enforce caps, write MORNING.md
  templates/
    STATE.md  config.yaml  RELEASE.md  nightwatch-readme.md
  docs/install.md
  test/fixtures/                    # one fixture repo per acceptance criterion
```

**A host repo after install + first runs (total footprint):**

```
.nightwatch/                        # Nightwatch's single home (zero Nightwatch files in root by default)
  README.md                         # orientation: the four-column map (edit? / owner / delete? / commit?), written by init
  # ── read (morning) ──
  MORNING.md                        # THE file: byte-identical copy of the newest dated brief — open this
  # ── edit (daytime — overnight runs never rewrite your content) ──
  STATE.md                          # your declarations (drafted by /nightwatch init)
  config.yaml                       # operational knobs; nothing here changes overnight
  RELEASE.md                        # release tracker (default release_path): the road first, Notes tail is yours
  # ── machine memory (committed, never opened or edited by hand) ──
  briefs/2026-07-08.md              # dated copies of each brief (committed — they're memory)
  ledger.jsonl                      # every finding + your checkbox verdicts, backfilled automatically
  .gitignore                        # nested: ignores runtime/ without touching the repo's root .gitignore
  # ── disposable runtime (gitignored as a unit; deleting it only resets cadence) ──
  runtime/
    cursors.json                    # cadence cursors + last-run dates (formerly state.json — legacy
                                    # path still read; the machine's cursor, unrelated to STATE.md)
    out/                            # per-run JSON, transient — internal EXCEPT *.patch files, which
                                    # the brief links by full path and which survive while their
                                    # finding is open (spec: docs/specs/finding-lifecycle.md P5)
```

By default **no Nightwatch-owned file lands in the repo root** — the `.nightwatch/`
directory is the single home. `RELEASE.md` can be relocated to the root (or elsewhere,
e.g. `docs/`) via `release_path` (§7) for projects that want it as a public deliverable —
the one opt-in exception. Every user-facing description of this layout — the README,
install docs, `init` output, and `.nightwatch/README.md` — uses the tier vocabulary shown
above and answers the four questions per file: *edit? / owner / safe to delete? /
committed?* (specs: `docs/specs/output-file-taxonomy.md`, `docs/specs/runtime-layout.md`).
The `runtime/` boundary is normative: everything under it is disposable and gitignored;
nothing outside it is. Legacy paths (`state.json`, top-level `out/`) are read as
fallbacks until an `init --update`-confirmed migration; a run-start `git check-ignore`
probe on the ledger and briefs emits one setup finding when the repo's ignore rules
would discard Nightwatch's memory, and an install predating the current layout gets one
Machine-notes nudge pointing at `init --update` (runtime-layout P3/P4).

**Cross-repo coupling: none.** Each installation is self-contained. Multi-repo
aggregation is explicitly not this plugin's job; a portfolio view would be a separate
consumer that reads each repo's `MORNING.md`.

### 2.5 Shared findings contract

Every job emits `.nightwatch/runtime/out/<job>-<date>.json` (legacy `.nightwatch/out/`
read as fallback until migrated — §2.4) conforming to one schema. This is
the inter-command interface: `release-progress` consumes the other jobs' findings
through it, and the brief collector consumes all three. Jobs are therefore loosely
coupled — any job runs standalone, and a partial night degrades cleanly.

```json
{ "schema": 1, "job": "repo-reconcile", "date": "2026-07-08",
  "degraded": ["no STATE.md authority block"],
  "findings": [ {
    "id": "RC-0031",
    "kind": "drift|arch|blocker|decision|setup|info",
    "severity": 1,
    "title": "README documents --tag flag removed from CLI",
    "evidence": [{"path": "README.md", "line": 41}, {"path": "src/cli.ts", "line": 12}],
    "action": "patch-available|human-decision|daytime-task",
    "next_step": { "summary": "Apply the ready-made README fix",
                   "command": "git apply .nightwatch/runtime/out/reconcile-2026-07-08-RC-0031.patch",
                   "effort_min": 2 },
    "verified": true
} ] }
```

- `schema` versions the format; consumers reject a major version they don't know
  rather than misreading it.
- `id` is stable across runs (content-hash of locus + kind) — this is what makes
  ledger dedupe, recurrence counting, and acted-on/dismissed tracking work.
- `severity`: integer 1–5, **1 = blocker/worst … 5 = nice-to-have** — this direction is
  normative for every producer and consumer (the `lib/types.js` typedef conforms to this
  line, never the reverse; findings 0030). Blocker *classification* keys on
  `kind: "blocker"` — `severity === 1` alone never promotes a finding to blocker, so a
  producer disagreeing about scale direction cannot fabricate release blockers.
- `verified`: survived the adversarial pass; only verified findings enter the brief.
- `next_step` (optional): the finding's morning rendering — `summary` (imperative,
  verb-first, ≤ 60 chars), `command` (copy-pasteable, optional), `effort_min` (coarse
  minutes estimate, optional). Written by the job's judgment layer and reviewed by the
  same adversarial pass as the finding itself; the brief collector renders action lines
  from it mechanically (§6) and falls back to `title` when absent
  (spec: `docs/specs/brief-composition.md`).
- **Lifecycle (spec: `docs/specs/finding-lifecycle.md`):** a finding stays **open** —
  and keeps rendering in the brief — until resolved or dismissed. Every run classifies
  each open finding (`re-observed` / `resolved` / `still-open` / `not-re-examined`) via
  a zero-token deterministic evidence recheck plus a budgeted judgment recheck
  (`recheck_budget`, reserved before new discovery), and records the classification as
  ledger rows; forced re-runs always leave a ledger trace (`forced: true`). Patch files
  are named per finding id and are never deleted while their finding is open.
  Classification is **run-relative** (P7): the incoming open set excludes rows written
  by the current run (keyed on run identity, not date alone), so tonight's rows are
  outputs, never inputs — on a repo's first run the incoming open set is empty and
  every finding classifies as **new** (no freshness suffix; arithmetic "N new,
  0 re-observed"). **Run-row ownership (FR94):** the ledger holds at most **one
  authoritative run row per (job, effective run date, `run_ordinal`)**. The **member job's
  CLI is that row's owner** — it writes it after its own judgment completes, carrying the
  real finding/candidate count; the collector **never appends a duplicate** when that row
  already exists, and writes a `synthetic: true` row **only** when no member row exists
  (a crashed, timed-out, skipped, or standalone-invoked member). `run_ordinal` is the
  brief-assembly cycle for the date (shared by both writers), so a forced same-date re-run
  stamps the next ordinal and cannot create two representations of one logical run
  (findings 0032/0034).

All shared schemas (findings, signals, tracker items) are defined exactly once, as
JSDoc typedefs in `lib/types.js` (§2.8); every producer and consumer imports them.

### 2.6 Extractor adapter architecture

Principle 6 made concrete. An **extractor adapter** is a thin module that turns one
analyzer's output into the shared signals schema. Nightwatch's judgment layer consumes
*only* the normalized schema — never a tool's raw output — so adapters are swappable
and new ecosystems never touch core code.

**Two classes of extractor:**

1. **Universal built-ins** — always available, pure Node, no external tool:
   `universal-git` (churn, co-change coupling, hotspots, size/growth trends) and the
   file-tree/README/TODO-density signals. These are the floor every run stands on.
2. **Tool adapters** — wrap a mature, actively maintained analyzer that the *host
   environment* provides. Nightwatch never bundles, installs, or downloads analyzers
   (that would break both the dependency-light contract and the overnight no-network
   rule, §6). An adapter uses a tool only if it resolves locally.

**Adapter contract.** Every adapter exports four functions:

| Function | Purpose |
|---|---|
| `detect(repo)` | Does this ecosystem apply? (lockfile/manifest heuristics, e.g. `package.json`, `pyproject.toml`) |
| `available(repo)` | Can the tool run? Resolution is **local-only**: host repo's `node_modules/.bin` (or venv `bin/`), then `PATH`. Never `npx`-fetch, never install, never network. |
| `run(repo, config)` | Invoke the tool, parse its native output, return signals conforming to the shared schema |
| `explain()` | One-line description + install hint, used for degraded notices and by `/nightwatch init` |

Detection without availability is not an error: it produces a `degraded` entry
("dependency-cruiser not installed — layering and cycle signals unavailable; universal
git signals used") and, once per repo, a `setup`-kind finding suggesting the daytime
install. `/nightwatch init` runs `detect`/`available` for all adapters and offers the
install commands interactively — installing tools is daytime work with a human present.

**Normalized signals schema** — `out/signals-<date>.json`:

```json
{ "schema": 1, "date": "2026-07-08",
  "sources": [{"extractor": "node-depcruise", "tool": "dependency-cruiser@18.0.0"},
              {"extractor": "universal-git"}],
  "degraded": [],
  "signals": [ {
    "kind": "layering-violation|cycle|orphan|unused-export|duplication|co-change|hotspot|growth|speculation",
    "confidence": "exact|heuristic",
    "evidence": [{"path": "src/ui/table.js", "line": 3}, {"path": "src/core/db.js"}],
    "detail": "src/ui → src/core import violates declared layer rule ui ↛ core",
    "source": "node-depcruise"
} ] }
```

`confidence: exact` marks signals a real analyzer proved (a cycle dependency-cruiser
found *is* a cycle); `heuristic` marks statistical ones (co-change coupling). The
judgment layer weighs them accordingly and says which kind it is citing.

**v0.1 adapters and what they replace:**

| Adapter | Tool (host-provided) | Signals delivered | Replaces custom code for |
|---|---|---|---|
| `universal-git` | git only | co-change, hotspot, growth | — (this one stays custom; it's universal and small) |
| `node-depcruise` | [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | dependency edges, cycles, orphans, layering-violation | JS/TS import graph + layering analysis |
| `python-importlinter` | [import-linter](https://github.com/seddonym/import-linter) | layering-violation, independence/forbidden contract breaks | Python import graph + layering analysis |

Candidate future adapters, same contract, not in v0.1: `knip` (JS unused
exports/dependencies → `unused-export`/`speculation` signals), `vulture` (Python dead
code). They are named here so the speculation-signal design assumes adapters, not
custom AST analysis.

**Layering rules are compiled, not reimplemented.** The user declares `layers:` once
in `.nightwatch/config.yaml` (§7). Each adapter compiles that declaration into its
tool's native rule format — a generated dependency-cruiser ruleset, generated
import-linter contracts — written under `out/` (transient), and maps violations back
to `layering-violation` signals. One declaration, N enforcers, zero custom graph code.
If the host repo already has its own `.dependency-cruiser.cjs` or import-linter
config, the adapter uses the *host's* config verbatim and reports that it did (the
repo's own rules are a declaration too — principle 5).

**Extension rule (normative).** Supporting a new ecosystem or analyzer means adding
one file under `scripts/extractors/` implementing the contract, plus fixtures. If a
new ecosystem seems to require changes elsewhere, the contract is what gets fixed.

### 2.7 Tracking store abstraction

**Decision for v0.1: the tracking layer stays custom** — `RELEASE.md` (human-facing
tracker) plus `.nightwatch/ledger.jsonl` (append-only finding history). Rationale:
both are zero-dependency, committed with the repo, human-diffable, and small; adopting
Beads or Backlog.md now would impose a tool install on every host repository, which
the portability gate forbids. This is a *reviewed* decision, not a default: the
revisit trigger is when tracker round-trip maintenance (parse → merge → serialize)
starts consuming real implementation effort, or when a host repo already runs one of
those tools and wants Nightwatch to feed it.

**What makes migration cheap later is the interface, so it is normative now.** All
tracker and ledger I/O goes through `lib/tracker.js`, which exposes a backend-neutral
store:

```
openTracker(repo, config)  → TrackerStore
TrackerStore:
  listItems(filter)                     // stable ids, status, section, evidence
  upsertItem(item)                      // create or update; never deletes
  completeItem(id, evidence)            // move to done with closing evidence
  appendStatus(line)                    // dated status entry, capped history
  recordFindings(findingsJson)          // ledger append + dedupe by finding id
  recordFeedback(marks)                 // acted-on / dismissed backfill
  query(q)                              // recurrence counts, demotion rule input
  flush()                               // atomic write of whatever the backend owns
```

Backends: `markdown` (v0.1 — writes `RELEASE.md` at `release_path` (default
`.nightwatch/RELEASE.md`, §7) + `.nightwatch/ledger.jsonl`), `beads` and
`backlogmd` (future — same interface over `bd` / `backlog` CLIs, subject to the same
local-only availability probe as extractor adapters). Selected by
`tracking.backend` in config; an unknown or unavailable backend is a `setup` finding
and the run falls back to `markdown`.

Constraints that keep every backend equivalent (and migration mechanical):

- **Item ids are stable and backend-independent** (same content-hash scheme as
  findings). A future migration is "replay items into the new store", not a parse of
  prose.
- **Evidence is structured** (`{path, line}` objects), never only prose, in every
  backend.
- **Human-owned content is marked and byte-preserved** — the markdown backend's
  **Notes** section and human-authored item text; other backends must offer an
  equivalent protected field.
- **No module other than `lib/tracker.js` reads or writes `RELEASE.md` or
  `ledger.jsonl`.** The §5 and §6 specs are written against the store interface.

### 2.8 Language and type policy

- **Plain JavaScript (CommonJS), Node ≥ 18, `js-yaml` as the only runtime
  dependency.** No build step: the install contract is clone →
  `npm install --omit=dev` → run. This is deliberate; TypeScript would cost either a
  compile stage or a Node ≥ 22.18 engine bump for native type stripping, and the
  portability gate values "runs anywhere Claude Code runs" over annotation syntax.
- **Type safety comes from the checker, not the compiler.** Every file under
  `scripts/` carries `// @ts-check`; shared shapes (findings, signals, tracker items,
  config) are JSDoc `@typedef`s defined once in `lib/types.js` and imported via
  `@type`/`@param` annotations everywhere they cross a module boundary.
- **`tsc --noEmit` is part of `npm test`** (TypeScript is a devDependency only —
  absent from a production install by `--omit=dev`). A type error fails CI exactly
  like a failing unit test.

### 2.9 Writing harness

Every generated document is written to a **declared primary objective** and under a
per-surface communication contract (spec: `docs/specs/writing-harness.md`):

| Document | Primary objective (falsifiable; timed cold-read acceptance) |
|---|---|
| `MORNING.md` | The maintainer begins productive work within **3 minutes** of opening it. |
| `RELEASE.md` | The maintainer can state the goal, current milestone, and next milestone within **1 minute**. |

- **Inclusion rule (per sentence):** content that doesn't speed the reader toward the
  objective moves below the fold, to an appendix, or out of the document.
- **Contract layers, matching principle 4:** judgment layers author prose fields under
  injected per-surface contracts (each section's declared reader question + the style
  rules W1–W10 — no hard wraps, self-evident references, milestone-by-name, one work
  vocabulary of *blocker / remaining work / waivable gate / later milestone*, one
  register, context restoration, work-briefing Details, maintainer's perspective);
  the deterministic collector lints the mechanical rules and falls back to mechanical
  rendering on failure; the adversarial pass adds a **reader-question check** alongside
  its truth check.
- **Citation integrity:** no bare `#N` — references are title-first or repo-prefixed;
  every cited PR/commit is verified against the *target* repo's own git history by a
  deterministic collector check (a non-matching citation is flagged and rendered
  numberless); the judgment layer may cite only target-repo artifacts, restated in
  every member-job prompt — dogfooding makes "the plugin's own repo is in context" the
  common case.
- **Status entries** answer, impact first: *what changed since yesterday, and does it
  need you?* — never an execution log.

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
symbols, command/skill files, config keys read by code, file-tree shape. This stays
custom code (principle 6c: no mature open-source tool inventories "what a repo claims
to offer"), but it is structured like the adapters — per-ecosystem probes behind one
schema, with the universal fallback (file tree + command files + README code blocks)
when no probe matches. Where a tool adapter can supply part of the surface (e.g. a
future `knip` adapter's export inventory), the probe consumes the adapter's signals
instead of re-deriving them. Output: `out/surface-<date>.json`.

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
5. For drifted claims in `derived` artifacts **whose fix is a pure deletion** (stale
   text whose source is gone): generate a unified-diff **patch file**
   at `runtime/out/reconcile-<date>-<finding-id>.patch` (per-finding naming; a patch is
   never deleted while its finding is open — spec: `docs/specs/finding-lifecycle.md`
   P5). **The mechanical patch surface is delete-only by design**
   (`docs/specs/reconcile-patch-workflow.md` P3, maintainer Decision 2 2026-07-11):
   additive or modifying drift on a `derived` artifact is a `human-decision` finding
   that presents the proposed text as proposal content in the finding body — never a
   hand-assembled patch file outside the helper contract, and no undocumented entry
   path for judgment-authored patches exists. Additive/modify helpers become a proposal
   again only when repeated dogfooding shows the human applying proposed text
   unmodified.
   If `patch_branch: true`, additionally apply the patch on branch
   `nightwatch/reconcile/<date>` created in a **temporary worktree** — the user's
   working tree and checked-out branch are never touched. For drifted claims
   involving an `authoritative` artifact: `human-decision`, and no patch is ever
   drafted in either direction.

**Outputs:** findings JSON — ≤ `caps.reconcile` findings, ranked by user-facing
severity (a documented-but-nonexistent command outranks a stale internal comment),
each carrying `next_step` where a concrete morning action exists (for a patch: the
`git apply` command, §2.5); patch file when applicable. `human-decision` findings
render as decide-actions in the brief's composition (§6).

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

**Deterministic layer** — `extract-signals.js`, the extractor runner (§2.6): runs
`detect`/`available` for every adapter, invokes the matching available ones plus the
universal built-ins, and merges everything into one `out/signals-<date>.json`. Signal
classes and where they come from:

- *Layering:* declared `layers:` compiled into the matching tool's native ruleset
  (dependency-cruiser for Node/TS, import-linter for Python); violations map to
  `layering-violation` signals with `confidence: exact`. Only when `layers:` is
  declared or the host repo carries its own tool config (§2.6). No adapter available
  → skipped with a `degraded` notice, never approximated from custom graph code.
- *Cycles, orphans, dependency structure:* tool adapters (`confidence: exact`).
- *Speculation:* unused exports / config keys read nowhere / flags untouched > 60
  days. Delivered by tool adapters where one exists (future `knip`/`vulture`);
  otherwise limited to what universal signals support (TODO-density, stale-flag
  heuristics from git), marked `confidence: heuristic`, with the gap stated in
  `degraded`.
- *Duplication:* near-duplicate names/signatures across modules; heavy import-set
  overlap. Import-set overlap uses adapter dependency edges when available; the
  name-similarity heuristic is universal.
- *Hidden coupling:* files co-changing in > N commits across module boundaries —
  `universal-git`, always available.
- *Growth:* size and churn trends; hotspots with high churn and zero mentions in the
  declared architecture document (only when `authority.architecture` exists) —
  `universal-git`, always available.

**Judgment layer** — consumes only the normalized signals schema; for each signal,
the agent:

1. Reads the declared architecture authority doc if any; an abstraction that document
   mandates is `keep` even at one implementation — cited, not argued around. This
   context is exactly what pure metrics miss.
2. Argues **both sides** ("earns its keep because… / speculative because…") before a
   verdict: `keep` / `simplification-candidate` / `decision-needed`. Signals marked
   `heuristic` need corroboration (a second independent signal or a targeted code
   read) before they can ground a candidate; `exact` signals stand on their own.
3. Attaches an estimated blast radius to each candidate (files, tests, public surface
   touched) so the morning reader can size the work at a glance.
4. Adversarial pass: a second subagent attempts to refute each candidate; only
   survivors are `verified: true`.
5. Ranks phase-aware: `phase: prototype|building` weights overengineering up;
   `phase: released` weights drift and coupling up; no phase → neutral.

**Outputs:** findings JSON — ≤ `caps.arch_candidates` candidates, ranked, each with
evidence pointers and blast radius (rendered under the brief's Details, §6); overflow
to the appendix (ids only). The brief's Machine notes name which adapters ran and
which were skipped and why.

**Safety rules (normative):** writes nothing outside `.nightwatch/`; never proposes
removing anything the architecture authority names as intentional without flagging
the relevant section; no overnight follow-up implementation — executing a
simplification is a daytime session; never installs or downloads an analyzer (§2.6 —
tool absence degrades, it is never "fixed" overnight). Unparsable source is reported
and skipped, never "fixed".

**Failure handling:** no adapter for the language, or adapter's tool not installed →
universal signals plus `degraded` notice naming the missing tool and its one-line
install hint; adapter crashes or emits unparsable output → that adapter's signals
dropped with a notice, everything else proceeds; shallow git history (< 20 commits) →
co-change checks skipped with notice; budget exhausted → partial output labeled
partial. **Honest emptiness (content-repo-scoping P7):** per signal class, *empty with
substrate* renders as clean, but *empty without substrate* (no imports for
duplication/import-overlap, no typed language for speculation, a scope-emptied source)
carries one `degraded` line naming the class as vacuous — and a live threshold that
provably exceeds the observable maximum (e.g. coupling `min_commits` above the repo's
max per-file churn) is stated with both numbers, reporting only, never auto-tuned. A
run whose signal classes are **all** vacuous emits a single summary degraded line, and
its zero-candidate judgment path is explicit: skip the adversarial refute pass, emit an
empty findings file with the degradations, stop.

**Acceptance criteria:**
- [ ] Fixture with a one-implementation interface *with* an authority-doc mandate and
      one *without*: first → `keep` citing the doc; second → candidate.
- [ ] Two modules co-changing in 8 commits → hidden-coupling finding from git data
      alone, in a language with no adapter.
- [ ] Node fixture with dependency-cruiser installed and declared `layers:` violated
      by one import → layering finding with both file pointers, `confidence: exact`,
      sourced from the compiled ruleset; same fixture *without* dependency-cruiser
      installed → no layering finding, one degraded notice with the install hint, and
      a `setup` finding (first run only).
- [ ] Python fixture with import-linter and a violated `layers:` declaration → same
      behavior via the `python-importlinter` adapter.
- [ ] Fixture repo carrying its own `.dependency-cruiser.cjs` → adapter uses the
      host config, reports that it did, and emits violations from the host's rules.
- [ ] Same declared `layers:` fixture without `layers:` and without host tool
      config → no finding, one not-configured notice.
- [ ] Fresh zero-config repo → valid (possibly near-empty) report, zero writes
      outside `.nightwatch/`.
- [ ] Unchanged repo, two runs → identical finding ids; recurrence counted in the
      ledger, nothing re-reported as new.

**Tests:** one fixture per signal class; adapter contract conformance (each adapter
run against a fixture with the tool present, absent, and crashing); layers-to-ruleset
compilation golden files for both tools; adversarial-pass survival asserted on a
known-good and a known-refutable candidate; determinism (shuffled file order →
identical signals JSON).

---

## 5. `/release-progress` — specification

**Purpose:** maintain a living tracker of the distance to public release, so "what's
done / what remains / what's next / how close" survives between sessions without
human bookkeeping.

**All tracker I/O goes through the tracking store (§2.7).** This section specifies
behavior against the store interface; the concrete file format below is the
`markdown` backend's serialization, which is the v0.1 default and the only backend
shipped.

**Markdown backend: `RELEASE.md` at `release_path` (default `.nightwatch/RELEASE.md`).**
Nightwatch keeps a single home under `.nightwatch/` (§2.4), so the release tracker lands
there by default; a project that wants it as a public root-level deliverable sets
`release_path: RELEASE.md` (§7). A legacy root `RELEASE.md` is read/adopted until `init`
migrates it. Markdown with YAML frontmatter for machine fields, fixed section
headings, stable item ids, and one human-owned section the machine never touches:

```markdown
---
phase: hardening            # mirrors STATE.md
target: "v0.1 public release"
progress: 0.64              # 0–1 fraction of definition-of-done + blockers resolved (derived);
                            # stored as a fraction, rendered ×100 as a percent at display time
updated: 2026-07-08
---
# Release progress

## The road                   <!-- goal verbatim; ✓ ▶ ○ milestones; waivable hygiene gate; 🏁; "Blocked by:" line -->
## Next actions (top 3)
## Human decisions needed
## What changed lately (latest first, capped at 10 entries)
- 2026-07-08 — Reconcile is now idempotent — nothing needs you for it; one new blocker appeared: the quickstart link is broken (fix before tagging).

## Done — evidence appendix   <!-- completed work, each item with evidence link -->
## Parked (nice to have)
## Phase
## Notes (human-owned — never machine-edited)
```

Sections are serialized in **journey order** — the road first, history and evidence
below — and parsed by heading name, so files in either legacy order (pre-2026-07 or the
interim reader-side order) read correctly and re-serialize into this order on the next
rewrite (Notes stays last and byte-preserved). Milestone marks (✓ ▶ ○) are re-derived
from criteria state every run, never stored, and the declared journey comes from the
optional ordered `milestones:` key in `STATE.md`'s `release:` block (each milestone
references `definition_of_done` items by exact text; mismatches are setup findings;
absent `milestones:` → flat rendering plus one setup nudge). Legacy section headings
("Release blockers", "Remaining — …", "Status update", "Nice to have") are still parsed;
their contents render inside the road / What-changed sections. Spec:
`docs/specs/release-journey.md`. "What changed lately" entries follow the §2.9 status
contract — impact first, never an execution log.

Item format: `- [ ] <title> (evidence: path:line | spec §) · RP-014` — the id trails the
line so the reader meets the action before the code; leading-id lines from older files
parse identically. Ids are stable and backend-independent; completed items move to
**Done** with their closing evidence rather than being deleted.

**Where "done" comes from — two sources, kept distinct:**

1. **Declared:** the `STATE.md` `release:` block — `target:` plus
   `definition_of_done:` (human judgment, e.g. "quickstart reproduces in 15 min on a
   fresh clone"), plus the optional ordered `milestones:` list (name + `criteria:`
   exact-text references to DoD items) that turns the flat criteria into the journey
   the road renders. Absent `release:` → source 2 only, and the tracker header says
   *"generic criteria — declare `release:` in STATE.md for a real definition of done"*.
2. **Generic:** `release-checks.js`, deterministic hygiene checks valid for any
   public repo: LICENSE present; README has install + quickstart sections; CI config
   exists (and last test run passes, if cheaply runnable); no committed-secret
   patterns; TODO/FIXME count under threshold; version/tag consistency; CHANGELOG
   presence. Configurable via `release_checks.disable`. (Custom code by principle
   6c — no maintained open-source tool covers this checklist portably.)

**Procedure (judgment layer):**

1. Run `release-checks.js`; read the `release:` block; open the tracking store
   (instantiating from the template on the markdown backend's first run); read
   tonight's reconcile and arch-review findings JSON **if present** — the command is
   fully functional standalone.
2. Reconcile the store against reality: complete items whose evidence now exists
   (recording the evidence link); upsert newly discovered items; promote
   `human-decision` findings into **Human decisions needed** and `blocker`-kind findings
   into **Release blockers** (§2.5 — never keyed on a severity endpoint) —
   cross-referenced by finding id, so they clear
   automatically when the source finding clears.
3. Never delete an item it didn't create; a human-added item that appears obsolete is
   tagged `(stale? — confirm)` instead.
4. Recompute `progress:` (fraction of definition-of-done items plus blockers
   resolved — a coarse honest number, not a promise); re-derive the road's milestone
   marks from criteria state **and persist the resolved criterion→done map** —
   per criterion `{criterion, done, evidence, match: exact | resolved}` — into the
   findings/tracker output (release-journey P4.1; a paraphrase the judgment layer
   resolved is stated and becomes recorded fact); refresh **Next actions** (top 3, each
   naming — in words —
   the milestone it advances and what closing it unlocks); append one **What changed
   lately** entry per the §2.9 status contract; `flush()`.
5. Emit the journey payload for the brief: goal, ordered milestones with marks, **the
   criterion→done map**, and the
   current milestone's remaining criteria, blockers, decisions, next actions, plus the
   done/total ratio (the no-milestones fallback). The collector renders the brief's
   road from these fields — never the tracker's entry text (which would duplicate
   `RELEASE.md` verbatim; §6) **and never by re-matching raw criterion text**
   (release-journey P4.2): both roads consume the same recorded map, so RELEASE.md and
   the brief cannot disagree about where the user stands. When the map is absent and
   exact-text matching fails, the brief road renders the milestone state as
   *unavailable* — naming the setup finding — instead of a wrong mark (P4.3). The
   road's terminal line follows the declared target — *"🏁 Declare **<target>**
   done."* — with "Tag the release." only when a version/tag release check is enabled
   (P4.5; both documents inherit it from the same template text).

**Safety rules (normative):** the only repo file the markdown backend writes is
`RELEASE.md`; the **Notes** section and human-authored item text are byte-preserved
(every backend must honor the equivalent protected field, §2.7); it summarizes
distance-to-release but never *redefines* the target — target changes are human edits
to `STATE.md`.

**Failure handling:** malformed `RELEASE.md` (hand-edit broke the structure) → the
run writes nothing, emits a `setup` finding pointing at the parse error, and the
brief carries last night's snapshot with a staleness notice. `tracking.backend` set
to an unknown or unavailable backend → `setup` finding, fall back to `markdown` for
this run without migrating anything.

**Acceptance criteria:**
- [ ] Fresh repo, no `STATE.md` → valid `RELEASE.md` from generic checks, header
      carries the generic-criteria notice.
- [ ] Add a `release:` block → next run merges declared items without duplicating
      generic ones; existing ids unchanged.
- [ ] Complete an item (make its evidence real) → item checks off with evidence link,
      `progress` increases, status line records it.
- [ ] Hand-add an item and a Notes paragraph → both survive 5 consecutive runs
      byte-identical (aside from legitimate state changes).
- [ ] Reconcile emits a `blocker`-kind finding → it appears under Release blockers the
      same night, and moves to Done the night after the fix lands.
- [ ] No-change night → only `updated:` and one "no change" status line differ.
- [ ] `tracking.backend: beads` with no `bd` on PATH → `setup` finding, markdown
      fallback, no crash, no partial writes.
- [ ] A second (in-memory test) backend driven through the same store interface
      passes the same behavioral tests as the markdown backend — proving §5 is
      specified against the interface, not the file format.

**Tests:** document round-trip (parse → serialize → byte-identical); id stability
under retitling; progress arithmetic; merge behavior when both sources express the
same criterion; store-interface conformance suite run against every backend.

---

## 6. `/nightwatch` — orchestrator specification

**Purpose:** the single scheduled entrypoint. Runs what's due, in dependency order,
unattended; emits one capped, ranked morning brief; survives any member job failing.

**Execution order:** run-start checks (backfill feedback; load the **open-finding set**
from the store and run the deterministic evidence recheck — finding-lifecycle P1/P2;
the `git check-ignore` memory probe and the layout nudge — runtime-layout P3/P4) →
`repo-reconcile` → `arch-review` (only if due per cadence) → `release-progress` (last,
so it consumes tonight's findings) → `collect-brief.js`. Each member runs as an
independent subagent with its `budget_tokens` and `effort` from config, receives its
open findings, and reserves `recheck_budget` for judgment rechecks **before** new
discovery; end-of-run classifications land as ledger rows. A crash or budget
exhaustion is recorded as one brief line and **never blocks the remaining jobs** — the
findings-file contract means `release-progress` runs on whatever JSON exists, so
partial nights degrade cleanly.

**Interactive-run presentation** (presentation only — no new scheduling logic; every
line is derived from `orchestrate.js --plan` output and config): before launching any
member subagent, an interactive run prints the plan — due members in order with their
`budget_tokens`, `effort`, and `timeout_minutes`; skipped members with `next_due`; a
total token ceiling and bounded duration; and a scope preview (analyzed top-level
directories with file counts, excluded directories with counts, computed by a
deterministic walk of the resolved scoping globs at zero model-token cost). While
running, each lifecycle event — member started, member finished (`ok` / `crashed` /
`timeout` / `skipped`), brief assembly — is narrated as exactly one line: the same
facts recorded in `out/run-status-<date>.json`, shown live. `--plan` prints the plan,
estimate, and scope preview and exits: zero model-token spend, zero writes.

**First-run confirmation gate:** when no cadence cursors exist
(`runtime/cursors.json`, legacy `state.json`) **and** no ledger exists — a repo with a
ledger is an existing install whose disposable runtime was merely deleted, not a first
run — *and* the session is interactive, the orchestrator asks one yes/no after showing
the plan, before launching members. Declining stops before any subagent launch and before any
write. `--force` (or `--yes`) skips the gate. Scheduled/unattended runs never prompt —
the constrained permission profile (safety rules below) always wins; if the
environment cannot prompt, proceed. From the second run onward there is no gate. On
scheduled runs the plan and scope summary are not printed; they land in
`out/run-status-<date>.json` and the brief's scope line instead.

**First-run confirmation screen (presentation).** Every option names its effect in plain
language — no internal jargon (e.g. *"Ignore untracked temporary files and run,"* not
"ignore strays"). The *setup-only* option states that it writes `.nightwatch/STATE.md` and
`.nightwatch/config.yaml` and that `/nightwatch` can be run later. Any option that edits
`config.yaml` **previews the exact block it will write before writing it**; declining writes
nothing. When the scope preview surfaces untracked files it proposes to exclude, they are
shown in **groups** — likely temporary/crash artifacts (e.g. `*.stackdump`, `core.*`,
`*.tmp`) versus ordinary untracked documents — acceptable independently; the grouping is a
name-pattern heuristic the present human confirms, never a run-time content judgment.

**`init` mode (daytime, interactive — the one mode that may ask questions):** detects
missing `.nightwatch/STATE.md` / config; interviews the human (authority per area, phase —
with sharpened adjacent-phase descriptions and, when cheap deterministic signals exist
(release/tag, published-package manifest, semver), one non-binding `Suggested:` line; on a
no-substrate repo with no such signals, no suggestion renders and nothing weaker is
inferred — first-run-ux P9; release target and definition of done — `milestones:` criteria
are **copied verbatim** from DoD entries, validated at write time (release-journey P4.4);
optional layers); classifies analysis scope **substrate-aware** (content-repo-scoping
P1/P2/P5): with an import substrate, known dev-tooling conventions plus heuristic
candidates (top-level git-tracked directories referenced by no product import) are
proposed; without one, tracked content is product by default and only convention
exclusions are proposed. Convention exclusions arrive **pre-checked** and every entry is
described in analysis-scope terms (what including/excluding means for what Nightwatch
analyzes); **declining a convention candidate writes its `!glob` negation** — a decline
is a declaration, never a placebo. Confirmed entries land in
`config.yaml` `dev_tooling:`, a declaration, visible and
versioned, not a hidden default; probes every extractor adapter (§2.6) and offers
install commands for detected-but-unavailable tools — the only moment tool
installation is ever suggested; writes both declaration files (`.nightwatch/STATE.md`,
`.nightwatch/config.yaml`) from templates, plus the `.nightwatch/README.md` orientation
file (the ~15-line §2.4 tier map, from `templates/nightwatch-readme.md`; recreated by
`init` if deleted, never written overnight), and registers a nested `.nightwatch/.gitignore`
(never touching the repo's root `.gitignore`); when a legacy root `STATE.md`/`RELEASE.md`
is present — or a legacy runtime layout (`state.json`, top-level `out/`) — offers a
one-time, human-confirmed, content-preserving migration into `.nightwatch/` (and into
`runtime/cursors.json` / `runtime/out/`, rewriting the nested `.gitignore` to ignore
`runtime/`); presents the plan, estimate, and scope preview and asks the first-run
confirmation (this is where most users pay their first full budget); runs each job once as an
**initial validation run** (a full `--force` write run — not the deferred signals-only
`--dry-run`); shows the first brief.

`init` is **create-only for declarations**: it instantiates them only where absent, never
refreshes an existing declaration, and reports each already-existing one in a single line
(*"already exists — not updated; edit it directly or run `/nightwatch init --update`"*). To
bring declarations back in sync as the repo evolves, **`/nightwatch init --update`** (daytime,
interactive, non-destructive) re-runs detection and proposes human-confirmed diffs to the
existing declarations and `dev_tooling` — applying only confirmed changes, byte-preserving the
rest — with the declaration and `dev_tooling` write paths unified under one confirm gate.
Overnight mode never creates or edits declaration files, never reclassifies scoping, and never
installs anything.

**Brief assembly** (`collect-brief.js` — deterministic, because truncation must be
mechanical; ranking *within* jobs is the jobs' judgment). The brief is composed
**roadmap-first** under the §2.9 objective (*productive work within 3 minutes*):
orientation — what you finished, where you are on the road — precedes triage, and
everything above the fold serves it (design inputs:
`docs/prototypes/MORNING-2026-07-11.md` + round-2 feedback; spec:
`docs/specs/brief-roadmap-composition.md`, superseding `brief-composition.md`'s order):

- **Composition, in order (each section's reader question is declared in the spec):**
  title + date → **status line** ("is anything on fire?") → `## Since yesterday`
  ("what did I just finish?" — merges/commits since the previous brief, tracker items
  completed, milestone movement, findings **resolved**; one-line form on a no-change
  night) → `## The road to release` ("what's the goal, where am I, what's next?" — the
  §5 journey payload compacted: goal verbatim and attributed, ✓ ▶ ○ milestones with the
  current one tagged *you are here*, next and following always visible, the waivable
  hygiene gate labeled, one **Blocking the release:** line; falls back to the
  ratio-plus-remaining-titles rendering with a setup nudge when no `milestones:` is
  declared, and to the run-`/release-progress` hint with no tracker) → `## ▶ First
  action` (exactly one; one affordance line at first use: *"Tick `[x]` when done, `[-]`
  to dismiss — Nightwatch reads it back."*) → `## If you have energy after that` →
  fold marker (*"Everything below is supporting detail. You can stop reading here."*) →
  `## Details` (**work briefings** per action — what to change / why / expected outcome
  and verification — then the finding appendix: evidence, severities, human-visible
  ids, anchors, and the ids-only overflow) → `## Machine notes — nothing to act on`
  (degraded notices including which extractor adapters ran/skipped/crashed;
  zero-finding jobs; the lifecycle arithmetic line; probe/nudge lines; the scope line)
  → footer.
- **The action sections render the OPEN finding set** (finding-lifecycle P1) — open
  findings stay in the brief with a freshness suffix (re-observed / evidence still
  present / not re-examined since DATE) until resolved or dismissed; resolved findings
  appear once under Since yesterday. `caps.brief_total` applies to the open set.
- **Status line, derived from counts:** blockers > 0 → "**N release blocker(s).**";
  else decisions > 0 → "**N decision(s) need you.** Nothing else is blocking."; else →
  "**Quiet night.**" plus one clause naming what waits (or "Nothing needs you today."
  at zero findings). Blocker counting keys on `kind` (§2.5). **Sanity check:** if the
  count-derived headline would claim blockers while the road's "Blocking the release:"
  line says "nothing" — both derive from the same night — the headline degrades to the
  decisions-tier form and one Machine-notes line reports the disagreement (refines the
  FR56 rule; finding 0030). A crashed or timed-out member is named in the status line,
  never only below the fold.
- **First-action selection is mechanical:** interleave priority class → severity →
  **advances-the-current-milestone** (boolean, from the tracker's finding↔criteria
  cross-reference) → lowest `effort_min` (absent sorts last) → id. A `human-decision`
  finding is an action too ("Decide: …"). Action lines name — in words — the milestone
  they advance (W3/W4) and are self-contained for a reader who forgot yesterday (W7).
- **Action lines** render from `next_step` (§2.5): checkbox, bold verb-first summary,
  `~N min` when estimated, the copy-pasteable command when present, at most one
  plain-language sentence of why, an anchor link into Details. Finding ids appear on
  action lines only inside an invisible manifest comment (`<!-- ids: RC-0031 -->`);
  human-visible ids live in Details. Findings without `next_step` fall back to `title`.
- **Bundling:** findings with a byte-identical `next_step.command` merge into one
  action line covering all their ids (the manifest lists each) — N config-drift
  findings sharing `/nightwatch init --update` become one action. Exact command
  equality only, no similarity judgment; the cap counts the underlying findings.
- Global cap `caps.brief_total` (default 25). Interleave priority when over cap:
  blockers > human decisions > drift > arch > nice-to-have.
- Writes `briefs/<date>.md`, overwrites `MORNING.md` (a byte-identical copy of the
  dated brief), appends per-job ledger lines (date, job, tokens, findings count,
  degraded flags) — through the tracking store.
- One scope line per brief, under Machine notes:
  `Scope: <n> files analyzed; excluded <dirs with counts> — edit .nightwatch/config.yaml to change.`
- One footer line naming both feedback methods:
  `Review interactively with /nightwatch review — or mark boxes by hand: [x] acted on, [-] dismissed.`
- Config-drift nudge, substrate-aware (content-repo-scoping P2): on a repo **with** an
  import substrate, a new top-level directory not covered by the resolved product scope,
  `ignore`, or `dev_tooling` produces a drift finding naming it and pointing at
  `/nightwatch init --update`; a directory named by a STATE.md authority path or a
  confirmed re-include counts as classified (no nag). On a repo **without** one, a new
  top-level directory is product by default and produces exactly **one** Machine-notes
  notice (*"analyzed as product (default); declare it to exclude"*) on its first
  appearance and none after — the "unclassified" vocabulary does not apply. Detection
  and reporting only; overnight writes no declarations. Multiple such directories bundle
  into a single action (above).

**Morning feedback loop:** brief action lines render as checkboxes (`acted-on` /
`dismissed`); the next run backfills the marks into the ledger via
`recordFeedback()`, reading each line's ids manifest — a mark on a bundled action
fans out to one feedback row per covered id, idempotent per id. The demotion rule
(principle 3) is computed from `query()`: a
member job with zero acted-on findings for two consecutive runs is flagged for
retirement or redesign in the next brief — the system proposes pruning itself.

**`review` mode (daytime, interactive):** `/nightwatch review [--brief <date>]` walks
the current brief's unmarked action lines in brief order (a bundled action is one
question), offering **acted-on** / **dismissed** / **skip for now** per action —
strictly selection-based; the three actions are the entire input vocabulary.
Interpretation is the interactive layer's job; writing is deterministic: each decision
immediately runs
`scripts/review-feedback.js --id <finding-id> --mark acted-on|dismissed` (once per
covered id for bundles), which
appends one feedback row via `recordFeedback()` (the sole sanctioned ledger writer,
dated to the brief under review) and rewrites the matching checkbox in `MORNING.md`
and the dated brief, so file state and ledger state never disagree. Already-recorded
ids are a stated no-op, so review, backfill, and manual checkbox edits compose in any
interleaving without double-counting. Quitting mid-review loses nothing. Manual
checkbox editing remains fully supported; the brief's footer names both methods.

**Safety rules (normative — these bind every member job; the orchestrator enforces
them by contract and its prompt restates them):**

- Never implements features; never refactors; never modifies source code.
- Write surface, exhaustively: `.nightwatch/**` (which now holds `STATE.md`, `RELEASE.md`
  by default, `config.yaml`, `.gitignore`, briefs, ledger, state, and `out/`), the
  configured `release_path` when set outside `.nightwatch/` (markdown tracking backend),
  patch files under `runtime/out/` (per-finding named; preserved while their finding is
  open — finding-lifecycle P5), and (opt-in) `nightwatch/*` branches via temporary worktree.
  Nothing else, ever — never the user's current branch or working tree, and never the
  project's root `.gitignore`. `init` migration moves a legacy root `STATE.md`/`RELEASE.md`
  only with the human's confirmation. A non-markdown tracking backend's write surface is
  its own store, declared in config.
- Never pushes, never creates PRs or issues, never posts externally; **no network** —
  which includes never fetching or installing analyzer tools (§2.6); absence
  degrades, it never triggers a download.
- Idempotent per date: a second same-night invocation sees the cadence cursors
  (`runtime/cursors.json`) plus the dated brief and exits without re-spending tokens
  (`--force` to override). **The night's own state-advancing scheduler call is immune to
  the night's own artifacts:** its idempotency gate keys on the recorded
  `last_brief_date` **only**, never on the dated brief file — which the same night's
  brief-assembly step has always already written by the time cursors are advanced
  (finding 0031; on a fresh repo the documented sequence must leave
  `runtime/cursors.json` existing, with weekly cadences dated out). A forced re-run
  always leaves a ledger trace — run and
  classification rows marked `forced: true`, never swallowed by the same-date guard —
  and never deletes a patch whose finding is still open (finding-lifecycle P5/P6).
- Job CLIs never write on unknown invocations: `--help` / `-h` / an unrecognized flag
  prints usage and exits **without executing and without writing**, and a job CLI
  refuses to run when cwd is not a git checkout and no explicit `--repo` was given —
  an exploratory invocation must never create `.nightwatch/` where the caller stands
  (finding 0034).
- Runs under a constrained permission profile in which prompts are impossible, not
  rare — unattended is precisely when a prompt cannot be answered.

**Failure handling:** repo is not a git checkout → abort with a one-line stub brief;
member job exceeds `timeout_minutes` → killed, noted, next job proceeds; the brief
collector itself fails → raw findings JSON remains in `runtime/out/` and a stub brief names
the failure. No brief at all is itself a signal; the collector always attempts a stub.

**Acceptance criteria:**
- [ ] One member job deliberately crashing → brief contains the other jobs' content,
      the status line names the failure, and Machine notes carries the one-line
      failure notice; orchestrator exits success.
- [ ] Second run the same night → no token spend, no file changes.
- [ ] 60 synthetic findings across jobs → brief holds exactly `caps.brief_total`,
      interleaved by priority class, appendix lists the remainder by id.
- [ ] Full run on a repo with no config, no `STATE.md`, and no analyzer tools
      installed → valid brief whose top items are the setup findings, degraded
      notices name the missing tools, and there are zero writes outside the declared
      write surface (asserted by `git status` plus a filesystem snapshot diff) and
      zero network access (asserted by running with network disabled).
- [ ] After 3 simulated nights, the ledger answers the demotion query mechanically.
- [ ] The identical checkout passes the full acceptance run in both distribution
      modes: registered as a plugin (`CLAUDE_PLUGIN_ROOT`) and as symlinked commands
      with `NIGHTWATCH_ROOT` set.
- [ ] Interactive run prints plan + estimate + scope preview before any subagent
      launches; `--plan` exits with zero model-token spend and zero writes.
- [ ] First run (no cadence cursors and no ledger), interactive: declining the gate
      launches nothing and writes nothing. Scheduled run on the same repo: no prompt,
      byte-identical behavior to the ungated orchestrator. Deleting `runtime/` on a
      repo that has a ledger does NOT re-arm the gate.
- [ ] `review` mode: each decision produces exactly one ledger feedback row and the
      matching checkbox update; review-then-backfill and backfill-then-review record
      no duplicates; quitting mid-review preserves recorded decisions.
- [ ] Fresh run on a fixture repo containing `_bmad/**` and `.claude/**` with no
      config file: zero extraction/judgment/verification tokens spent on those trees;
      the brief carries the scope line.
- [ ] A user `ignore:` list extends rather than replaces shipped defaults; `!pattern`
      re-includes a default-excluded path with exactly one config entry.
- [ ] First-run confirmation screen: every option is labelled in plain language; the
      setup-only option states it writes `.nightwatch/STATE.md` and `.nightwatch/config.yaml`
      and that `/nightwatch` runs later; any option that edits `config.yaml` previews the
      exact block before writing; untracked files proposed for exclusion are shown in at
      least two groups (temporary/crash vs ordinary documents), acceptable independently.
- [ ] Consolidated layout: a fresh install leaves zero Nightwatch-owned files in the repo
      root (only `.nightwatch/`); `STATE.md` is read from `.nightwatch/STATE.md` with a
      legacy-root fallback; `init` creates `.nightwatch/.gitignore` and never edits the
      root `.gitignore`.
- [ ] `release_path` (default `.nightwatch/RELEASE.md`) determines where the release report
      is written and read; `release_path: RELEASE.md` opts into a root deliverable; a legacy
      root `RELEASE.md` is adopted until migrated, byte-preserved.
- [ ] `init` on a repo with legacy root `STATE.md`/`RELEASE.md` offers a one-time confirmed
      migration into `.nightwatch/`; declining leaves the files in place and all reads still
      succeed; an existing install works with no migration.
- [ ] `init` is create-only for declarations and reports each already-existing one; a
      scheduled run reclassifies nothing and writes no declaration files.
- [ ] `/nightwatch init --update` proposes human-confirmed diffs to existing declarations
      and `dev_tooling`, applies only confirmed changes byte-preserving the rest, and is
      idempotent (a no-change repo proposes nothing).
- [ ] Overnight run on a repo with a new top-level directory not covered by the resolved
      product scope, `ignore`, or `dev_tooling`: exactly one drift finding names it and
      points at `init --update`; multiple such directories render as one bundled action
      covering all of them; a fully-classified repo emits none.
- [ ] Brief composition (roadmap-first): status line, `Since yesterday`, `The road to
      release`, and exactly one First action (with its copy-pasteable command when the
      finding carries one, and an affordance line at first use) all render above the
      fold, in that order; evidence and human-visible finding ids appear only below the
      fold; Details opens with per-action work briefings; degraded notices, the
      lifecycle arithmetic line, probe/nudge lines, and the scope line render under
      "Machine notes — nothing to act on"; findings without `next_step` render from
      titles with no blank sections and no crash.
- [ ] The action sections render the open finding set: a finding open from a previous
      run and not re-observed tonight still renders with its freshness suffix — never a
      "0 findings" brief over a non-empty open set; a resolved finding moves to `Since
      yesterday` and out of the actions; a no-milestones repo renders the road's
      ratio-fallback plus one setup nudge.
- [ ] Forced same-date re-run: ledger rows appended with `forced: true`; the patch of a
      still-open finding survives (or is regenerated) and the brief's apply command
      points at an existing file.
- [ ] Memory probe and layout nudge: a repo whose `.gitignore` ignores the ledger emits
      exactly one setup finding naming file, consequence, and fix; an install missing
      the orientation README (or on legacy runtime paths) gets exactly one Machine-notes
      nudge; a current, correctly-configured install gets neither.
- [ ] Zero blockers and zero decisions → the status line reads "Quiet night…"; the same
      inputs plus one `blocker`-kind finding flip it to name the blocker — derived from
      counts alone, byte-deterministic. A fabricated disagreement fixture (headline
      counts a blocker, road says "nothing") degrades to the decisions-tier headline
      with one Machine-notes line.
- [ ] Marking a bundled action `[x]` backfills exactly one feedback row per covered id;
      a subsequent backfill or `review` pass records no duplicates, in any interleaving
      with manual edits.
- [ ] A fresh `init` writes `.nightwatch/README.md` (four-column map) from the template
      and overnight runs never write it; `RELEASE.md` serializes in journey order (the
      road first) with trailing ids, reads files in either legacy order correctly, and
      byte-preserves Notes across the reorder; milestone marks re-derive from criteria
      state every run.

---

## 7. Templates (shipped in `templates/`)

**`STATE.md`** (instantiated to `.nightwatch/STATE.md`) — prose header explaining the file, plus the single parsed block:

```yaml
authority:
  architecture: {artifact: "docs/ARCHITECTURE.md", role: authoritative}
  behavior:     {artifact: "specs/*.md", role: authoritative, rule: newest-accepted-wins}
  usage:        {artifact: "README.md", role: derived}
phase: prototype            # prototype | building | hardening | released
release:
  target: "v0.1 public release"
  definition_of_done:       # unordered criteria (as today)
    - "quickstart reproduces on a fresh clone in 15 minutes"
    - "all commands have specs and the reconciler reports 0 drift"
  milestones:               # optional, ORDERED — the journey the road renders; each
    - name: "Quickstart proven"                    # references DoD items by exact text —
      criteria: ["quickstart reproduces on a fresh clone in 15 minutes"]
                            # init and init --update COPY the DoD text verbatim into
                            # criteria and validate at write time (release-journey P4.4)
    - name: "Specs and code agree"
      criteria: ["all commands have specs and the reconciler reports 0 drift"]
```

**`config.yaml`** — every key optional; defaults shown are the shipped defaults:

```yaml
cadence:  {repo-reconcile: nightly, arch-review: weekly, release-progress: nightly}
budget_tokens: {repo-reconcile: 200000, arch-review: 300000, release-progress: 100000}
effort:   {repo-reconcile: medium, arch-review: high, release-progress: medium}
caps:     {brief_total: 25, reconcile: 10, arch_candidates: 7}
ignore: []                  # never analyzed; EXTENDS shipped defaults ("!pattern" re-includes;
                            # negation is match-based — a subpath of an excluded parent
                            # re-includes with one entry)
                            # defaults: dist/**, build/**, out/**, vendor/**, node_modules/**,
                            #           .git/**, coverage/**, **/*.lock, .nightwatch/**
dev_tooling: []             # development-only tooling, not product; extends shipped defaults
                            # defaults: _bmad/**, _bmad-output/**, .claude/**,
                            #           !.claude/commands/**, .cursor/**
                            # (q_a/** removed 2026-07-11 — failed the criterion below on the
                            # first outside repo; content-repo-scoping P3. Criterion, stated
                            # per entry at the definition site: recognizable dev-workspace
                            # convention, near-zero chance of being product surface. On a
                            # repo with no import substrate, tracked content is product by
                            # default — only these conventions exclude.)
extractors: auto            # or a list, e.g. [universal-git, node-depcruise]
                            # tool resolution is always local-only: host repo's
                            # node_modules/.bin (or venv), then PATH; never installed
tracking:
  backend: markdown         # v0.1 ships markdown only; future: beads | backlogmd
release_path: .nightwatch/RELEASE.md   # where the release report lives; set "RELEASE.md"
                            # (or e.g. "docs/RELEASE.md") to keep it as a root/public deliverable
layers: []                  # e.g. [{name: core, path: "src/core/**", may_depend_on: []}]
                            # compiled into each available tool's native ruleset (§2.6)
release_checks: {disable: []}
recheck_budget: 0.15        # fraction of each job's budget reserved (before new discovery)
                            # for judgment rechecks of open findings (finding-lifecycle P3)
patch_branch: false         # true → also apply derived-doc patches on nightwatch/* branches
timeout_minutes: 30
```

**`RELEASE.md`** (instantiated at `release_path`, default `.nightwatch/RELEASE.md`) — the §5 skeleton with empty sections and the Notes guard comment.

**`nightwatch-readme.md`** (instantiated to `.nightwatch/README.md` by `init`) — the
orientation file: the four-column map per file (*edit? / owner / safe to delete? /
committed?*) grouped by the §2.4 tiers, including the two deletion subtleties (deleting
`runtime/` only resets cadence; deleting `ledger.jsonl` destroys memory) and the
`STATE.md`/`cursors.json` disarming line, so the layout explains itself at the point of
encounter (runtime-layout P5).

---

## 8. Build order

1. **Plugin skeleton + `lib/types.js` + `lib/config.js` + `lib/findings.js` +
   `lib/tracker.js`.** Manifest; the type-check gate (`// @ts-check` everywhere,
   `tsc --noEmit` wired into `npm test`, §2.8); config precedence (shipped defaults ←
   `config.yaml` ← `STATE.md` yaml block); findings schema, stable-id hashing; the
   tracking-store interface with the markdown backend and an in-memory test backend.
   Everything depends on these.
2. **`/release-progress`.** First shippable value: needs only `release-checks.js`
   and the tracking store — no extractors — and it most directly attacks the
   losing-track problem. Dogfood standalone for a few days.
3. **`/repo-reconcile`.** `surface-inventory.js` with the Node probe plus the
   universal fallback; authority semantics; patch emission.
4. **`/nightwatch`.** Orchestrator over the two nightly jobs, `init` (including the
   adapter probe/install-hint flow), brief collector, ledger. Schedule it and start
   the trust ramp.
5. **Extractor runner + tool adapters (`extract-signals.js`, `node-depcruise`,
   `python-importlinter`), then `/arch-review`.** The adapters land with the job that
   consumes them; arch-review carries the heaviest judgment load and is weekly
   anyway, so it joins a system that has already earned morning attention.

### The portability gate — every increment must pass this before merging

Install the plugin into a **fresh, unrelated fixture repo** — no `STATE.md`, no
config, a language without an adapter, no analyzer tools installed — and run
`/nightwatch`. Required result: a valid brief whose top findings are the setup
declarations, zero guessed authority, zero writes outside the declared write surface,
zero network access, clean exit. Then run the identical build against 2–3 real
repositories that differ only in their local `STATE.md`/`config.yaml` (at least one
with dependency-cruiser or import-linter installed, to exercise a tool adapter end to
end). If any of them needs a plugin-side change, that change must be a new config
key, a new extractor adapter, or a new tracking backend — never a special case naming
a repository.
