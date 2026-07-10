# Dogfooding finding 0009 — `init`'s post-setup run is mislabeled a "dry-run" (it writes everything)

- **Date:** 2026-07-10
- **Session:** third dogfooding round.
- **Command:** `/nightwatch init` — the post-setup first run (step 5/6).
- **Classification:** terminology / documentation issue — the run behaves correctly; the *name* is
  wrong and collides with a different, deferred feature.
- **Status:** documented; recommended rename below. No changes implemented.

## Observed behavior

`init`'s final step runs the full overnight flow once (with `--force`) and is described as a
**"dry-run"**:

- `nightwatch.md` §6: *"runs each job once in **dry-run**; shows the first brief."*
- `commands/nightwatch.md` step 6: *"**Present the plan and dry-run.** Run the overnight flow below
  with `--force`…"*

But this run is a **full write run**. It writes `.nightwatch/STATE.md`, `.nightwatch/config.yaml`,
`.nightwatch/state.json`, `RELEASE.md`, `.nightwatch/MORNING.md`, dated briefs, and patch files —
the entire declared write surface. The message *"the first overnight pass ran end-to-end as a
dry-run"* is therefore misleading: nothing about it is dry.

## Why this matters

- **"Dry run" conventionally means "no side effects."** A user told the run was a dry-run reasonably
  believes nothing was written, then finds a half-dozen new/changed files. That's the opposite of
  what the word promises.
- **It collides with a real, deferred feature.** `first-run-ux.md` P5 defines a genuine
  **signals-only `--dry-run`** tier (run the deterministic scripts, near-zero cost, **no writes**) —
  currently deferred. Using "dry-run" for init's full write run means the same term names two
  opposite behaviors; when the real `--dry-run` ships, the docs already (mis)use its name for its
  inverse.

## Risks

- Users mistrust the run's honesty ("it said dry-run but wrote files") on first contact.
- The deferred `--dry-run` feature inherits a polluted, self-contradicting name.

## Suggested improvement

Rename init's post-setup full run to **"initial validation run"** (or **"first verification run"**)
everywhere it's described — `nightwatch.md` §6, `commands/nightwatch.md`, and the "post-setup dry
run" phrase in `first-run-ux.md` P5 — and **reserve `--dry-run` strictly for the deferred
signals-only, no-write tier**. The two are opposites and must not share a name.
