# Dogfooding finding 0003 — README gaps surfaced by the first real run

- **Date:** 2026-07-10
- **Artifact:** `README.md` (written 2026-07-10, before the first dogfooding run)
- **Classification:** documentation issue — the README is accurate to the design spec but
  diverges from the experienced behavior in ways a first-time user notices immediately.
- **Status:** documented only. The suggested changes below are the actionable list; no
  separate spec is needed and the README has **not** been edited.

## Observed gaps

Each gap is something the first run demonstrated that the README either states differently
or does not state at all.

### 1. Command names don't match the actual plugin commands

The README documents `/nightwatch`, `/repo-reconcile`, `/arch-review`, `/release-progress`.
When installed as a registered plugin, Claude Code namespaces commands by plugin — the first
run was actually invoked as **`/nightwatch:nightwatch`**. A user typing the README's bare
names may not find the commands, and a user seeing `/nightwatch:nightwatch` in their command
list won't connect it to the README table.

**Suggested change:** document the namespaced forms (`/nightwatch:nightwatch`,
`/nightwatch:repo-reconcile`, `/nightwatch:arch-review`, `/nightwatch:release-progress`) as
the primary names for plugin installs, noting the bare forms apply to the symlink install
(Option B), where commands land in `~/.claude/commands/` un-namespaced.

### 2. `nightwatch init` is under-explained

The README calls init "interactive daytime setup" without saying what it actually does. A
user can't tell whether it is safe, what it writes, or why it matters.

**Suggested change:** state concretely that init (a) probes extractor adapters read-only and
offers install hints, (b) interviews you for the declarations no tool can infer (authority
per area, phase, release definition of done, layering), (c) instantiates `STATE.md` and
`.nightwatch/config.yaml` from templates without ever clobbering existing files, (d) adds
`.nightwatch/out/` to `.gitignore`, and (e) ends with a dry run that produces your first
brief while you watch.

### 3. Running without init is a degraded, detection-only mode — the README doesn't say so

The README notes that both declaration files are optional and commands "degrade gracefully,"
which reads as "init is skippable with no real loss." The first run showed what degraded
means in practice: without declared authority, Nightwatch can *detect* disagreements but
cannot say which side is wrong or propose a fix direction; without a release definition,
release tracking is generic; undeclared inputs surface as setup findings occupying brief
slots.

**Suggested change:** state plainly that an uninitialized repo runs in a **detection-only
mode** — findings report *that* things disagree, not *which way to fix them* — and that
init is what unlocks direction, release tracking against your own definition of done, and a
quieter brief.

### 4. Concurrency of independent jobs is unstated

The README describes a fixed order (reconcile → arch-review → release-progress). In the
observed run, the independent members ran **concurrently** as parallel subagents; only
`release-progress` is order-constrained (it consumes the night's findings JSON, so it runs
last). A user watching multiple simultaneous background agents has no way to square that
with the README's sequential description — which fed the "is it stuck?" confusion of finding
[0001](0001-first-run-visibility.md).

**Suggested change:** describe the real execution shape — independent jobs may run in
parallel; `release-progress` always runs last — so the multi-agent activity a user sees
matches what they read.

### 5. First-run duration is unstated

Nothing warns that the first night is the most expensive: there is no prior `state.json`, no
ledger, no baseline — every member is due and every signal is computed from scratch. The
observed first run took over ten minutes (see findings [0001](0001-first-run-visibility.md)
and [0002](0002-analysis-scope-dev-tooling.md)).

**Suggested change:** add one sentence to the Quickstart: the first run establishes the
repository baseline and may take several minutes; later runs are cheaper because cadence
skips undue members and the ledger carries memory forward.

### 6. Intended audience is unstated

The README explains what Nightwatch does but not who it is for. The design assumes a
specific reader: a maintainer of an actively developed repo — particularly AI-assisted,
spec-driven development where code, specs, and docs drift apart overnight — who has morning
attention to spend on a capped brief and CI/tests already covering correctness. It is not a
linter, not a security scanner, and not a code-review bot for PRs.

**Suggested change:** add a short "Who this is for" paragraph naming that reader and the
non-goals, so mismatched expectations are corrected before install rather than after the
first brief.

## Why this matters

The README is the product's first claim about itself, and Nightwatch's own reconcile job
exists to catch exactly this class of drift — docs disagreeing with observed behavior. Each
gap above produces a concrete first-run failure: commands not found (1), init skipped as
optional busywork (2, 3), parallel agents mistaken for runaway processes (4), a healthy run
interrupted as stuck (5), or the wrong users installing it at all (6).
