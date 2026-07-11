---
description: Maintain RELEASE.md — the living path-to-release tracker (nightly). Read-mostly; the only repo file it writes is RELEASE.md.
argument-hint: "[--repo .] [--force]"
---

# /release-progress

You maintain a living tracker of the distance to public release so "what's done / what
remains / what's next / how close" survives between sessions without human bookkeeping.
The **only repo file you may write is `RELEASE.md`**. You never modify source, never push,
never publish.

## Script root resolution

Every script and template path below is relative to the Nightwatch root. Resolve it once,
before running anything, and call the result `${NW_ROOT}` for the rest of this file:

1. If `${CLAUDE_PLUGIN_ROOT}` is set, use it (official plugin install).
2. Else if `${NIGHTWATCH_ROOT}` is set, use it (local/symlink install — see `docs/install.md`).
3. Else stop immediately and report: "Nightwatch root not found — set `NIGHTWATCH_ROOT` to the
   plugin directory (see docs/install.md) or install Nightwatch as a Claude Code plugin." Do
   not guess a path.

## Inputs

- `${NW_ROOT}/scripts/release-checks.js` — deterministic hygiene checks (generic source of "done").
- `STATE.md` `release:` block (declared source of "done") — read via config.
- The current `RELEASE.md` (or the template on first run).
- Tonight's `.nightwatch/out/repo-reconcile-<date>.json` and `arch-review-<date>.json` **if present** (you are fully functional standalone).

## Procedure

1. Run the deterministic layer and load config:
   ```
   node ${NW_ROOT}/scripts/release-checks.js --repo .
   ```
   Read `.nightwatch/out/release-checks-<date>.json`. Read the `release:` block from `STATE.md`
   (parse the single fenced yaml block). Read the current `RELEASE.md`; if absent, instantiate
   from `${NW_ROOT}/templates/RELEASE.md`.

2. **Two distinct sources of "done", kept separate:**
   - *Declared* — `release.definition_of_done` items from `STATE.md`. If the `release:` block is
     absent, use source 2 only and set the header note *"generic criteria — declare `release:`
     in STATE.md for a real definition of done"*.
   - *Generic* — the `release-checks.js` results (LICENSE, README install+quickstart, CI,
     secrets, TODO threshold, version/tag, CHANGELOG). When both sources express the same
     criterion, merge into one item — do not duplicate.

3. Reconcile the document against reality:
   - Check off items whose evidence now exists, recording the evidence link (`path:line` or `spec §`).
   - Add newly discovered items with stable ids (`RP-xxxx`).
   - Promote `human-decision` findings (from tonight's other jobs) into **Human decisions needed**
     and `blocker`-kind findings into **Release blockers** (keyed on `kind`, never on the severity
     endpoint — spec §2.5, FR91), cross-referenced by finding id so they clear automatically when
     the source finding clears.

4. **Never delete an item you did not create.** A human-added item that looks obsolete gets
   tagged `(stale? — confirm)`, never removed. The **Notes** section and all human-authored item
   text are byte-preserved.

5. Recompute `progress:` = fraction of (definition-of-done items + blockers) resolved — a coarse,
   honest number, never a promise. Refresh **Next actions (top 3)**, each pointing at a specific
   file or spec. Prepend one status-update line (cap the list at 10).

6. Write `RELEASE.md`. Emit findings JSON so the brief and ledger see this run:
   - Use the schema in `${NW_ROOT}/scripts/lib/findings.js` (require it, or write JSON
     conforming to `.nightwatch/out/release-progress-<date>.json`).
   - Include a ≤ 12-line brief summary as an `info` finding: progress delta since last run, new
     blockers, new decisions, next actions. Mark deterministic findings `verified: true`.

## Safety rules (normative)

- The only repo file written is `RELEASE.md`; **Notes** and human item text are byte-preserved.
- You summarize distance-to-release but never *redefine* the target — target changes are human
  edits to `STATE.md`.
- Malformed `RELEASE.md` (a hand-edit broke the structure) → write nothing, emit a `setup`
  finding pointing at the parse error, and let the brief carry last night's snapshot with a
  staleness notice.

## Idempotency

If `RELEASE.md`'s `updated:` already equals today's date and `--force` was not passed, make no
changes beyond confirming state; a no-change night differs only in `updated:` and one "no change"
status line.
