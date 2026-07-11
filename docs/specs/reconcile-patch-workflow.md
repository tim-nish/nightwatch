# Spec: Reconcile patch workflow — a patch is *available for the user to apply*, never something Nightwatch applies

- **Status:** proposed 2026-07-10 — **for review only.** Not folded into `nightwatch.md`; no FRs
  assigned. Refines the *presentation* of `/repo-reconcile`'s patch output (§3, FR20) — the
  never-edit-in-place contract already holds; this pins the wording around it. Captures the intended
  behavior for later triage. **P3 (delete-only mechanical surface)** added 2026-07-11 from finding
  0034 item 4, per maintainer **Decision 2**, and — unlike P1/P2, which remain proposed —
  **accepted 2026-07-11 and folded into `nightwatch.md` §3 (judgment layer step 5)** (see
  the [0026–0034 triage record](DRAFT-findings-0026-0034-triage.md)): mechanical patches
  stay delete-only; additive/modifying drift remains a human-decision path.
- **Motivated by:** dogfooding findings
  [0015 — Patch workflow wording](../dogfooding/0015-patch-workflow-wording.md) and
  [0034 — contract drift](../dogfooding/0034-member-command-contract-drift.md) (item 4 → P3)
- **Scope:** how `/repo-reconcile` **talks about** a patch it produced for a `derived` artifact,
  and (P3) which drift *directions* the mechanical patch surface covers. No change to what is
  detected or verified — reconcile still emits a patch file and never touches the working tree or
  checked-out branch. (P1's example paths predate the `runtime/` layout move and are updated by the
  0034.2 conformance sweep: `.nightwatch/runtime/out/…`.)

## Problem

After producing a reconciliation patch, Nightwatch asked **"Want me to apply it?"**. The contract is
that reconcile **never edits any repo file in place** — its deliverables are *patches-as-proposals*
(a patch file at `.nightwatch/out/reconcile-<date>.patch`) or human-decision findings
(`repo-reconcile.md`). The wording implies Nightwatch itself may modify the repository — contradicting
the exact boundary that lets a maintainer run it unattended. The patch is **for the user to apply**;
the tool's job is to make it *available*, not to offer to apply it.

## Design constraints (invariants this spec must not break)

1. **Never edit product sources in place.** Reconcile writes a patch file and leaves the working
   tree and checked-out branch untouched. The only sanctioned application path is the **user**
   running the apply command; the opt-in `patch_branch` mode applies the patch on a separate
   `nightwatch/*` branch via a temporary worktree — still never the user's working tree.
2. **Patches only for `derived` artifacts.** A conflict involving an `authoritative` artifact is a
   `human-decision` finding with no patch — unchanged.
3. **Presentation only.** This spec changes wording, not the mechanism, the write surface, or the
   findings schema.

## Proposal

### P1 — Frame the patch as available, and show the exact apply command

When reconcile has written a patch, present it as a proposal the **user** applies, with the concrete
command — never as something Nightwatch will do:

```
A reconciliation patch is ready (derived artifact drifted from the code).
To apply it yourself:  git apply .nightwatch/out/reconcile-<date>.patch
(Nightwatch never edits your sources — this patch is a proposal for you to apply.)
```

- State the **patch location** and the **exact apply command** so availability is actionable.
- Optionally mention `git apply --check <path>` for a dry run and that the opt-in `patch_branch`
  mode would instead land the same patch on a `nightwatch/*` branch.

### P2 — Never imply Nightwatch will apply it

Forbid wording that offers or implies in-place application, e.g. "Want me to apply it?",
"Should I fix it?", "Apply now?". Nightwatch surfaces and locates the patch; the human decides and
runs the command. This holds anywhere a patch is announced — the reconcile summary, the brief's
patch pointer, and any interactive follow-up.

### P3 — The mechanical patch surface is delete-only; other drift is a human decision *(added 2026-07-11, Decision 2)*

Observed gap (0034.4): the shipped patch helper covers only deletions (`unifiedDiffDelete`),
while `commands/repo-reconcile.md` calls patch files "the default and only mechanism" for
`derived` drift — so the first real *additive* drift (README missing four documented commands)
forced the member to hand-assemble a unified diff outside any contract. Rather than growing the
surface, the claim is narrowed to match the design:

- **Delete-only is the designed mechanical surface, stated as such.** A `derived` artifact whose
  drift is a pure deletion (stale text whose source is gone) gets a patch file, exactly as today.
  The command doc's "default and only mechanism" wording is scoped to this case.
- **Additive or modifying drift on a `derived` artifact is a `human-decision` finding.** The
  finding presents the proposed text *as proposal content* (in the finding body / details
  section) — never as a hand-built patch file, which would be an uncontracted write with no
  helper guaranteeing its correctness. The human applies the change themselves; the never-edit-
  in-place contract (constraint 1) is untouched.
- **No sanctioned CLI entry path for judgment-authored patches is added.** The undocumented-glue
  route observed in 0034 (judgment layer post-merging artifacts via internal exports) is not
  legitimized; it disappears when the above two rules make it unnecessary.
- **Revisit criterion, declared now:** additive/modify helpers (`unifiedDiffAdd`/`Modify` or
  `git diff --no-index` generation) become a proposal again only when repeated dogfooding shows a
  stable, bounded helper contract — concretely, recurring additive-drift findings whose proposed
  text the human applied unmodified, evidencing that mechanical generation would have been safe.

## Non-goals

- No in-place application of a patch to the user's working tree, ever — including behind a "yes".
- No change to `patch_branch` behavior (opt-in, separate branch via temporary worktree).
- No change to which artifacts get a patch (`derived` only) or to the findings schema.

## Acceptance criteria

1. When reconcile has produced a patch, the presentation frames it as **available for the user to
   apply** and includes the exact command (`git apply .nightwatch/out/reconcile-<date>.patch`) and
   the patch's location.
2. No user-facing text offers or implies that Nightwatch will apply the patch to the working tree
   ("Want me to apply it?" and equivalents are gone).
3. The mechanism is unchanged: a patch file is written for `derived` drift; the working tree and
   checked-out branch are never modified; `authoritative` conflicts remain patch-less
   human-decisions.
4. *(P3)* Deletion drift on a `derived` artifact yields a patch file; additive/modifying drift on
   the same artifact yields a `human-decision` finding carrying the proposed text as content, with
   no patch file written; `commands/repo-reconcile.md` states the delete-only scope wherever it
   describes the patch mechanism.
