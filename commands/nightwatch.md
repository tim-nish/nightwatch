---
description: Orchestrator — run what's due (reconcile → arch-review → release-progress) and emit one capped, ranked morning brief. `init` runs interactive daytime setup; `review` walks the morning brief. The scheduled entrypoint.
argument-hint: "[init|review] [--repo .] [--force] [--yes] [--brief <date>]"
---

# /nightwatch

The single scheduled entrypoint for unattended overnight review. You run the member jobs that
are due, in dependency order, then assemble one capped, ranked morning brief. You survive any
member job failing. With the argument `init`, you instead run interactive daytime setup.

## Script root resolution

Every script and template path below is relative to the Nightwatch root. Resolve it once,
before running anything, and call the result `${NW_ROOT}` for the rest of this file:

1. If `${CLAUDE_PLUGIN_ROOT}` is set, use it (official plugin install).
2. Else if `${NIGHTWATCH_ROOT}` is set, use it (local/symlink install — see `docs/install.md`).
3. Else stop immediately and report: "Nightwatch root not found — set `NIGHTWATCH_ROOT` to the
   plugin directory (see docs/install.md) or install Nightwatch as a Claude Code plugin." Do
   not guess a path.

**These safety rules bind every member job and you enforce them by contract:**

- Never implement features, never refactor, never modify source code.
- Write surface, exhaustively: `.nightwatch/**` (now holding `STATE.md`, `RELEASE.md` by default,
  `config.yaml`, `briefs/`, `ledger.jsonl`, `state.json`, `out/`), the configured **`release_path`**
  when set outside `.nightwatch/` (e.g. a root or `docs/` `RELEASE.md`), patch files under
  `.nightwatch/out/`, and (opt-in) `nightwatch/*` branches via a **temporary worktree**. Nothing
  else, ever — never the user's current branch or working tree, never the project's root `.gitignore`.
- Never push, never open PRs or issues, never post externally. No network.
- Idempotent per date; runs under a permission profile where prompts are impossible.

**Writing contract (inject verbatim into every prose-producing job — spec writing-harness P4).**
Every document is written to a declared objective, under the per-surface contract that is the single
canonical source of its objective, section reader-questions, and style rules W1–W10. Before a member
authors any prose field, inject its surface's contract **verbatim** into that member's prompt — obtain
it deterministically (zero tokens, no model) with:
```
node ${NW_ROOT}/scripts/lib/writing.js  # or require('writing').assembleContract('MORNING.md' | 'RELEASE.md')
```
Prose is authored **once, as the structured fields the surface defines — never free text**, and each
section opens with its answer (BLUF); a sentence that answers no declared reader question is cut. A
generated document may reference **only** artifacts of the target repository — a citation you cannot
locate under the repo root is dropped, never trusted. Write as the maintainer's chief of staff (W10),
never as the tool's narrator.

**Adversarial pass — reader-question & citation refutation (spec writing-harness P4.3/P5).** In
addition to the existing truth check, the refuting reviewer is told the reader question each authored
field must answer and **refutes any field that does not answer it**, and **refutes any citation it
cannot locate under the target repo root**. The deterministic collector (`collect-brief.js`) enforces
the mechanical rules with no model call — mid-sentence hard wraps (W1) and bare `#N` (W2) degrade a
field to its title, and every `#N` absent from this repo's git history is flagged in Machine notes and
rendered without its number — so a lint or citation failure is never broken output.

---

## `init` mode (daytime, interactive — the ONLY mode that may ask questions)

Run this when the user types `/nightwatch init`. The interview is yours to conduct; the file
writing, the adapter probe, and the template instantiation are **deterministic** and delegated
to `${NW_ROOT}/scripts/init.js` so setup is reproducible and never improvised.

1. **Precondition.** Verify this is a git checkout (`init.js` aborts with `not-a-git-checkout`
   otherwise). `init.js` also detects whether `.nightwatch/STATE.md` / `.nightwatch/config.yaml`
   already exist (a legacy root `STATE.md` counts as present too) — it will **never clobber** an
   existing declaration, so this mode is safe to re-run.

2. **Probe the extractor adapters** (read-only, writes nothing):
   ```
   node ${NW_ROOT}/scripts/init.js --repo . --probe
   ```
   This runs each adapter's `detect`/`available` **locally only** (host repo's `node_modules/.bin`
   or a venv, then `PATH` — never install, never network) and prints a per-adapter report
   `{ name, tool, detected, available, installHint }`. For every **detected-but-unavailable** tool,
   offer the human its `installHint` — **this is the ONLY moment tool installation is ever
   suggested.** Do not run the install yourself; hand the human the command.

3. **Interview the human** (you may ask questions here — the one mode that may): authority per area,
   phase, release target and definition of done, optional layering rules.

4. **Classify dev-tooling scope** (read-only detection, writes nothing):
   ```
   node ${NW_ROOT}/scripts/init.js --repo . --detect-dev-tooling
   ```
   This prints candidate top-level directories, each tagged `convention` (matches a shipped
   dev-tooling default) or `heuristic` (a tracked top-level dir referenced by no product import).
   Show them to the human and confirm which are development-only tooling — "develops the product
   but is not the product." Only the confirmed set is written (next step); this is a **visible,
   versioned declaration**, never a hidden default.

5. **Offer the one-time layout migration** (only if legacy root artifacts exist). Detect first
   (read-only, writes nothing):
   ```
   node ${NW_ROOT}/scripts/init.js --repo . --detect-migration
   ```
   This prints the legacy root files (`STATE.md`, `RELEASE.md`) that would move into `.nightwatch/`
   with each `{ from, to, tracked }`. If `moves` is non-empty, show them and ask the human to
   confirm the relocation — it is byte-for-byte and uses `git mv` for tracked files so history
   follows. On confirmation, pass `--migrate` to the write step; on decline, skip it and every read
   still succeeds via the backward-compatible fallback. Nothing moves without confirmation.

6. **Write the declarations from templates.** Run (add `--migrate` only if the human confirmed
   step 5):
   ```
   node ${NW_ROOT}/scripts/init.js --repo . --dev-tooling "dir1,dir2/**" [--migrate]
   ```
   This relocates any confirmed legacy artifacts first, then instantiates `.nightwatch/STATE.md`
   from `${NW_ROOT}/templates/STATE.md` and `.nightwatch/config.yaml` from
   `${NW_ROOT}/templates/config.yaml` **only where absent** (an existing declaration is preserved
   byte-for-byte), writes a nested `.nightwatch/.gitignore` ignoring `out/` **without touching the
   project's root `.gitignore`**, and persists the human-confirmed `--dev-tooling` set into
   config.yaml's `dev_tooling:` (extends the shipped defaults). Omit `--dev-tooling` if nothing was
   confirmed; pass `--no-config` to write `STATE.md` only. **init is create-only for declarations**
   — it instantiates each only where absent and never refreshes an existing one. Surface each
   declaration's `message` from the JSON report verbatim: a created file is reported as created, and
   an already-existing one as *"…already exists (path) — not updated; edit it directly or run
   `/nightwatch init --update`."* so the human learns the boundary. Then help the human fill the
   freshly written declarations from the interview answers (authority, phase, release, layers).

7. **Present the plan and initial validation run.** Run the overnight flow below with `--force` (a first-run
   scheduler call reports `gate.required`). Show the plan, estimate, and scope preview — this is
   where the human first sees the confirmed scope take effect and pays the first full budget — ask
   the first-run confirmation, then run each job once and show the first brief. Stop and let the
   human review.

### `/nightwatch init --update` — non-destructive reconfigure (daytime, interactive)

Run this when the user types `/nightwatch init --update`. Like `init`, it is a daytime,
interactive mode that may ask questions; it is **never** invoked on a scheduled run. It brings an
existing config back in sync as the repo evolves, without clobbering anything — it proposes only
what *changed* and applies only what the human confirms.

1. **Re-run detection** (read-only, writes nothing):
   ```
   node ${NW_ROOT}/scripts/init.js --repo . --update
   ```
   Prints `proposals` — each a `dev_tooling` candidate not yet covered, or a `module`: a new
   top-level directory no declaration classifies (neither product-declared nor in
   `ignore`/`dev_tooling`). A repo unchanged since the last init/update proposes nothing.
2. **Confirm per proposal.** Show each proposal's `summary` and let the human accept, edit, or
   skip it — a `dev_tooling` add classifies the dir as tooling; a skipped `module` stays product.
   Nothing is written for a skipped item.
3. **Apply only the confirmed set** — the confirmed dev-tooling additions are unioned with the
   current declaration and written, config.yaml otherwise byte-preserved:
   ```
   node ${NW_ROOT}/scripts/init.js --repo . --update --dev-tooling "dir1,dir2/**"
   ```
   A confirmed declaration-field change (e.g. `phase:`) is applied through the same gate
   (byte-preserving the rest of the file). Both write paths flow through this one
   propose → confirm → apply gate — nothing is create-only in one place and silent-overwrite in
   another. Re-running with no repo change proposes and writes nothing (idempotent).

Overnight mode never creates or edits `STATE.md` or `config.yaml`, **never reclassifies scoping**,
never runs `--update`, and never installs anything — `init` (and `init --update`) is the sole write
path for the declaration files, the sole place dev-tooling is classified, and the sole place
installs are suggested.

---

## `review` mode (daytime, interactive)

Run this when the user types `/nightwatch review` (optionally `--brief <date>` to review an older
dated brief instead of the current `MORNING.md`). You walk the brief's **unmarked** findings in
brief order and record the human's decision on each. The input vocabulary is **strictly three
selections** — nothing else: **acted-on**, **dismissed**, **skip for now**. Interpretation is your
job; writing is deterministic and delegated.

1. **List the walk queue** (read-only):
   ```
   node ${NW_ROOT}/scripts/review-feedback.js --repo . --list
   ```
   This prints every finding in brief order with its box state; walk the ones with `marked: false`.

2. **For each unmarked finding**, present it and offer the three selections. On a decision:
   - **acted-on** / **dismissed** → record it immediately:
     ```
     node ${NW_ROOT}/scripts/review-feedback.js --repo . --id <finding-id> --mark acted-on|dismissed
     ```
     This appends exactly one `type:"feedback"` row via the tracking store's `recordFeedback()`
     (the sole sanctioned ledger writer), **dated to the brief under review**, and rewrites that
     finding's checkbox in both `MORNING.md` and the dated brief — so file state and ledger state
     never disagree. An already-recorded id is a **stated no-op** (`status:"noop"`), so review, the
     morning backfill, and manual checkbox edits compose in any order without double-counting.
   - **skip for now** → do nothing; leave the box empty and move on.

3. **Quitting mid-review loses nothing** — every decision was already written when it was made.

Manual checkbox editing remains fully supported: the brief's footer names both methods, and the
overnight backfill picks up hand-marked boxes exactly as before. `review` writes only inside
`.nightwatch/**`, spends no tokens, and never runs a member job.

---

## Overnight flow (no argument)

The precondition, idempotency, cadence, and cursor decisions below are **not yours to improvise** —
they are computed deterministically by the scheduler so every night is reproducible. Get the plan
first, then execute exactly the members it lists:

```
node ${NW_ROOT}/scripts/orchestrate.js --repo . --plan
```

This prints `{ status, due, skipped, steps, members, estimate, scope }` and performs **zero writes
and spends zero model tokens** (FR41). `status` is `abort` (not a git checkout — emit the one-line
stub brief and stop), `noop` (a completed run already exists tonight and `--force` was not passed —
read `state.json` + the dated brief and exit **without spending tokens or changing files**), or
`plan` (proceed). `due` is the ordered member list to run; `skipped` explains each member left out
(with its `next_due` date); `steps` is `due…` followed by `collect-brief`.

**Interactive runs: show the plan before launching anything (FR37/FR38).** When this run is
interactive, render the enriched plan to the human *before* the first member subagent launches —
everything below is already in the `--plan` JSON, so this is presentation only and changes no
scheduling decision:

- **Due members, in order** — from `members`: each `job` with its `budget_tokens`, `effort`, and
  `timeout_minutes`.
- **Skipped members** — from `skipped`: each `job` with its `next_due`.
- **Estimate** — from `estimate`: the total `token_ceiling` (a hard budget ceiling, not a forecast)
  and the bounded `duration_minutes`.
- **Scope preview** — from `scope`: `analyzed` top-level directories with file counts and `excluded`
  directories with counts, plus the `analyzed_files` / `excluded_files` totals. Computed by a
  deterministic filesystem walk at zero model-token cost; a surprising split here means the scope is
  wrong — fix `.nightwatch/config.yaml` before spending the budget.

On **scheduled (non-interactive)** runs, print nothing: the same `scope` and `estimate` are written
to `.nightwatch/out/run-status-<date>.json` by the non-`--plan` scheduler call, and the exclusions
surface as the brief's one-line scope statement instead.

**First-run confirmation gate (FR40).** When `--plan` reports `gate.required: true` **and** this
session is interactive, ask the human exactly one yes/no *after* showing the plan above and *before*
launching any member subagent — this is the first time this repo pays a full budget, so confirm it
deliberately. `gate.required` is true only on the very first run (`first_run: true`, i.e. no
`.nightwatch/state.json` yet) and only when neither `--force` nor `--yes` was passed:

- **Declined** → stop now. Launch no members, run no `collect-brief`, and do **not** make the
  state-advancing scheduler call below. Nothing has been written and no tokens were spent (the only
  step so far was `--plan`, which writes nothing).
- **Confirmed** (or `--force`/`--yes`, or `gate.required: false`) → proceed to run members.
- **Non-interactive / scheduled runs never prompt** — the permission profile forbids it (safety
  rules above); if the environment cannot prompt, proceed. Behavior is byte-identical to the
  ungated orchestrator. From the second run onward `state.json` exists, so `gate.required` is false
  and there is no gate.

**Confirmation-screen presentation (FR45–FR47).** Label every option in **plain language** — no
internal jargon (never "strays"). The choices are:

- **"Run Nightwatch now"** — the full night above.
- **"Ignore untracked temporary files and run"** — offered only when the scope preview found
  untracked files that would otherwise be analyzed. Get them, classified, from:
  ```
  node ${NW_ROOT}/scripts/first-run.js --repo .
  ```
  which returns two **independently-acceptable** groups (FR47) — `groups.temp` (likely
  temporary/crash artifacts, safe to ignore) and `groups.documents` (ordinary untracked documents
  the human should review) — plus `ignore_preview.temp` / `ignore_preview.all`. Show them grouped,
  e.g.:
  ```
  Untracked files that would otherwise be analyzed:
    Likely temporary / crash artifacts (safe to ignore):
      bash.exe.stackdump
    Untracked documents (review — you may want these analyzed):
      answer.md   question.md
  ```
  The classification is a **name-pattern heuristic**, never a content judgment — the human decides.
- **"Write STATE.md and config.yaml only — run /nightwatch later"** — the setup-only path: it writes
  `.nightwatch/STATE.md` and `.nightwatch/config.yaml` and nothing else, and `/nightwatch` can be
  run later. State this effect in the label so it is not an ambiguous escape hatch.

**Preview any config change before writing it (FR46).** If a chosen option would edit
`.nightwatch/config.yaml` (e.g. ignoring the untracked files above), show the **exact** block first —
the `ignore_preview` string from `first-run.js`, e.g.:
```yaml
# will be added to .nightwatch/config.yaml
ignore:
  - answer.md
  - question.md
  - bash.exe.stackdump
```
The user confirms *this shown change*; **declining writes nothing**. `config.yaml` is a versioned
declaration the user maintains — a helpful write is still a write.

1. **Preconditions & idempotency.** Handled by the `abort` / `noop` statuses above. `orchestrate.js
   --plan` performs **no writes** — it only reads `.nightwatch/state.json` and config.

2. **Cadence.** `.nightwatch/state.json` holds one **human-inspectable cursor per member** —
   `{cadence, last_run, runs, next_due}` — plus `last_brief_date` (the idempotency sentinel).
   Cadence is config-owned (`repo-reconcile` nightly, `arch-review` weekly, `release-progress`
   nightly); a member whose cursor is not due tonight appears in `skipped`, so `arch-review` runs
   at most weekly. The file is created on first run.

3. **Run members in dependency order** — exactly the jobs in `due`, each as an independent subagent
   with its `budget_tokens`, `effort`, and `timeout_minutes` from config:
   1. `/repo-reconcile` (if due)
   2. `/arch-review` (if due)
   3. `/release-progress` (last, so it consumes tonight's findings JSON)

   A crash, timeout, or budget exhaustion of one member is recorded as **one line** and **never
   blocks the remaining jobs** — the findings-file contract means `release-progress` runs on
   whatever JSON exists, so a partial night degrades cleanly. Record per-member outcomes to
   `.nightwatch/out/run-status-<date>.json` as
   `{ "jobs": [ {"job","status":"ok|crashed|timeout|skipped","note","tokens"} ] }`.

   **Live narration (interactive runs only, FR39).** As each lifecycle event happens, narrate it as
   **exactly one line** — member started, member finished (`ok`/`crashed`/`timeout`/`skipped`), and
   brief assembly — using the *same* `{job, status, tokens, note}` you record to
   `run-status-<date>.json`, so the live line and the persisted fact never disagree. The formatters
   in `${NW_ROOT}/scripts/lib/narrate.js` produce those lines; `node ${NW_ROOT}/scripts/narrate.js
   --repo .` re-renders them from the record after the fact. On **scheduled** runs, narrate nothing
   — the facts still land in `run-status-<date>.json`.

4. **Assemble the brief** (deterministic — truncation must be mechanical):
   ```
   node ${NW_ROOT}/scripts/collect-brief.js --repo .
   ```
   This writes `.nightwatch/briefs/<date>.md`, overwrites `.nightwatch/MORNING.md`, appends
   per-job ledger lines, and computes the demotion rule. Fixed section order and the global cap
   `caps.brief_total` (default 25) with interleave priority (blockers > human decisions > drift >
   arch > nice-to-have) are enforced by the script, not by you.

5. **Morning feedback loop.** **Before running the jobs**, backfill last brief's checkbox marks:
   ```
   node ${NW_ROOT}/scripts/backfill-feedback.js --repo .
   ```
   This reads the previous `.nightwatch/MORNING.md` and, for each rendered finding whose box the
   user checked (`[x]` → acted-on; `[-]`/`[~]` → dismissed), appends one `type:"feedback"`
   correction row for that finding id to `ledger.jsonl` **through the tracking store's
   `recordFeedback()`** (the sole sanctioned ledger writer) — dated to the brief being marked, and
   skipping marks already recorded so a re-run never double-counts. The demotion rule (a member
   with zero acted-on findings two runs running) then folds these marks in when `collect-brief.js`
   computes it, surfacing the flag in the next brief — the system proposes pruning itself.

6. **Update `state.json`.** Run the scheduler once more without `--plan` to advance the cadence
   cursors (`last_run`, `runs`, `next_due`) for the members that ran and stamp `last_brief_date`:
   ```
   node ${NW_ROOT}/scripts/orchestrate.js --repo .
   ```
   This is the only step that writes `state.json`, and it writes nowhere else — the sole scheduler
   write lands inside `.nightwatch/**`. A subsequent same-night invocation now returns `noop`.

## Failure handling

Partial nights degrade cleanly — one member failing never blocks the others, and the human always
wakes to a brief (FR32):

- **Not a git checkout** → `orchestrate.js --plan` returns `status:"abort"` and writes a one-line
  stub `MORNING.md` (and dated brief) naming the failure. Stop; run no members.
- **A member crashes or exceeds `timeout_minutes`** → kill that subagent, then record its outcome
  in `.nightwatch/out/run-status-<date>.json` — `{"job", "status":"timeout"|"crashed", "note",
  "tokens"}` — and proceed to the next job. A member cadence left out records `"status":"skipped"`.
  `collect-brief.js` renders every non-`ok` status as exactly **one line** in the "Failures &
  degraded notices" section, so the surviving jobs' sections are untouched and the run still exits
  success.
- **`collect-brief.js` itself fails** → the raw findings JSON is left untouched in
  `.nightwatch/out/`, and the collector still writes a stub `MORNING.md` (and dated brief) naming
  the failure. **No brief at all is itself a signal — the collector always attempts a stub.**
