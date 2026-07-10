# Dogfooding finding 0015 — Patch-proposal wording ("Want me to apply it?") implies Nightwatch may edit product sources

- **Date:** 2026-07-10
- **Session:** dogfooding — third run on the *writing-assistant* repository.
- **Command:** `/repo-reconcile` → after emitting a reconciliation patch for a `derived` artifact.
- **Classification:** UX / wording — the mechanism is correct (a patch file is written and the
  working tree is never touched); the phrasing misrepresents the contract.
- **Status:** documented; folded into
  [`docs/specs/reconcile-patch-workflow.md`](../specs/reconcile-patch-workflow.md). No code changes
  implemented.

## Observed behavior

After producing a reconciliation patch, Nightwatch asked **"Want me to apply it?"**. Nightwatch's
contract is to **never modify product sources automatically** — reconcile writes a patch file at
`.nightwatch/out/reconcile-<date>.patch` and leaves the working tree and checked-out branch
untouched (`repo-reconcile.md`: *"never edits any repo file in place — proposals are patch files or
human-decision findings"*). The wording implied Nightwatch itself might edit the repository.

## Why this matters

1. **It contradicts the core boundary of the tool.** Reconcile's deliverables are
   **patches-as-proposals**, never in-place edits. Offering to "apply it" undercuts the exact
   guarantee the design rests on — the reason a maintainer can safely run Nightwatch against their
   repo unattended.
2. **The patch is for the user to apply, not for Nightwatch.** The helpful, contract-accurate
   framing makes the patch **available** and shows the exact command to run
   (`git apply .nightwatch/out/reconcile-<date>.patch`), so the user stays in control of any change
   to their sources.
3. **It sets a wrong expectation.** A user who answers "yes" expects Nightwatch to edit their code —
   which it must not do and, by contract, will not. Even *offering* it misrepresents the tool's
   role and spends trust the boundary was meant to earn.

## Risks

- Users believe Nightwatch edits their product sources, undermining the "deliverables are proposals,
  never in-place edits" guarantee.
- Confusion when answering "yes" does not (and must not) result in Nightwatch modifying files.
- The misframing normalizes an auto-apply mental model the tool deliberately refuses.

## Suggested improvements (folded into `docs/specs/reconcile-patch-workflow.md`)

1. **Frame the patch as available for the user to apply**, never as something Nightwatch will do.
   Replace *"Want me to apply it?"* with, e.g., *"A patch is ready. To apply it yourself:
   `git apply .nightwatch/out/reconcile-<date>.patch`."*
2. **Never use wording that implies Nightwatch will edit product sources.** The only sanctioned
   application path is the **user** running the command; the opt-in `patch_branch` mode applies the
   patch on a separate `nightwatch/*` branch via a temporary worktree, still never the user's
   working tree.
3. **State the patch location and the exact apply command**, so the patch's availability is
   actionable without any ambiguity about *who* applies it.
