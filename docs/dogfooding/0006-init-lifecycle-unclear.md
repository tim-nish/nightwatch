# Dogfooding finding 0006 — `init` has no lifecycle: unclear when to re-run, and whether it reinitializes or updates

- **Date:** 2026-07-10
- **Session:** second dogfooding round — running Nightwatch on a *different* repository (not the
  Nightwatch repo itself), after Epic 6 landed `/nightwatch init` with dev-tooling classification.
- **Command:** `/nightwatch init` (daytime, interactive setup)
- **Classification:** UX / lifecycle-clarity issue — not an implementation bug. The "never clobber"
  behavior is correct and safe; what's missing is a stated model for re-running `init` as a repo
  evolves, made worse by the two write paths behaving inconsistently.
- **Status:** documented only. No spec yet — the proposed improvements below are the actionable
  list; no changes implemented.

## Observed behavior

First-time `init` on the new repository was **great**: the adapter probe, the interview, the
dev-tooling classification, and the plan/dry-run all landed cleanly, and the repo was configured in
one sitting. The confusion started *after* the repository evolved — new top-level modules appeared,
the project phase moved on, and a new agent-workspace directory was added. The natural instinct was
"re-run `/nightwatch init` to bring the config up to date," and at that point the mental model broke
down:

- Nothing states **when** you should re-run `init`, or what triggers the need to.
- Nothing states **what re-running does** — a full reinitialization, or an incremental update of the
  existing config.
- Re-running produced a **partial, surprising** result (see below): some things updated, most did
  not, and the command didn't make clear which was which.

## What re-running `init` actually does (and why it's confusing)

The behavior is a mix of "create-only" and "update," with no stated model tying them together
(`scripts/lib/init.js`, `commands/nightwatch.md`):

- **Declaration files are create-if-absent — an existing `STATE.md` / `.nightwatch/config.yaml` is
  never touched.** `writeDeclarations` reports `{ written: false, reason: 'exists' }` and moves on
  ("never clobber an existing declaration"). So authority, phase, release target / definition of
  done, and layers declared on day one are **frozen**: re-running `init` will not refresh them, even
  though those are exactly the things that drift as a repo matures.
- **Dev-tooling classification *does* rewrite `config.yaml`.** When the interview confirms a set and
  `init` is called with `--dev-tooling`, `writeDevTooling` **replaces** the `dev_tooling:` line in
  place. So one part of the same command is an in-place update while the rest is create-only.
- **The adapter probe re-runs every time**, which reinforces the impression that "re-run = refresh,"
  right up until you notice `STATE.md` and the rest of `config.yaml` never changed.

The result: re-running `init` is neither a clean **full reinitialization** (it deliberately won't
overwrite your declarations) nor a clean **incremental update** (it won't reconcile them against how
the repo has changed either — except dev-tooling). It's "create whatever is missing, re-probe tools,
and optionally reclassify dev-tooling," which no user would guess from the name `init` or from
"safe to re-run."

## Why this matters

- **Repos evolve; the config is supposed to track them, but there's no path to keep it in sync.**
  New modules change what authority/layers should say; `phase: prototype → released` changes how
  arch-review ranks; a new release target changes the definition of done; a new agent-workspace
  directory should join `dev_tooling`. Today the only way to reflect any of that (except dev-tooling)
  is to **hand-edit** the files — but the docs frame `init` as the setup path and don't tell the user
  that maintenance is manual.
- **"Safe to re-run" is true but misleading.** It means "re-running won't destroy your work," which
  a user hears as "re-running will bring things up to date." Those are different promises, and only
  the first one holds.
- **The inconsistency between the two write paths is the sharpest edge.** A user who watches
  `dev_tooling:` get updated by a re-run reasonably assumes the rest of `config.yaml` (and
  `STATE.md`) updated too. It didn't.
- **The drift is silent.** Overnight runs degrade gracefully by emitting one-line *setup findings*
  for undeclared inputs, but nothing says "your `init` config is now stale relative to the repo —
  re-run / reconcile it." The loop that would teach the user *when* to act is missing.

## Risks

- Config silently drifts out of date as the repo grows; analysis is scoped and ranked against a
  stale picture (wrong `phase`, missing `layers`, un-excluded new dev-tooling dirs).
- Users hand-edit `STATE.md` / `config.yaml` without knowing that's the intended maintenance path,
  or (worse) assume a re-run already fixed it and never edit at all.
- The partial-update surprise erodes trust in `init` specifically — the one interactive,
  human-present moment the design leans on.

## Suggested improvements (proposed; no spec yet)

1. **State `init`'s lifecycle explicitly** in `commands/nightwatch.md` and the README: `init` is
   **create-only** for `STATE.md` / `config.yaml` and never overwrites them; re-running re-probes
   tools and can reclassify dev-tooling, but does **not** refresh existing declarations — edit those
   directly, or use the update path below.
2. **Give re-runs an honest report.** When a declaration already exists, surface it as one line
   ("`STATE.md` already exists — not updated; edit it directly or run `--update`") instead of a
   silent `reason: 'exists'` in JSON, so the user learns the boundary the moment they hit it.
3. **Add an explicit incremental path** — e.g. `/nightwatch init --update` (or a `reconfigure`
   mode) that re-runs detection (new top-level modules, newly-appeared dev-tooling dirs, changed
   tooling) and proposes **human-confirmed diffs** to the existing declarations without clobbering
   them — making "update my config to match how the repo changed" a first-class, non-destructive
   operation rather than manual editing.
4. **Reconcile the two write paths under one model.** Either both create-only (dev-tooling also
   proposed as a diff, not silently rewritten) or both update-capable behind the same
   `--update`/confirm gate — so nothing about `init` is create-only in one place and overwrite in
   another.
5. **Close the loop by flagging config drift in the brief.** When an overnight run sees a new
   top-level directory that no declaration classifies (already the source of setup findings), add a
   one-line nudge — "new directory `X/` is unclassified; run `/nightwatch init --update` or add it to
   `config.yaml`" — so the user learns *when* re-running is warranted instead of having to guess.
