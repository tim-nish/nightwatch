# Dogfooding finding 0011 — Doc↔implementation disagreement should be reported as "contract ambiguity," not silently patched toward the code

- **Date:** 2026-07-10
- **Session:** third dogfooding round.
- **Command:** `/repo-reconcile` (a doc-vs-implementation reconciliation).
- **Classification:** behavior / reporting principle — a refinement of reconcile's authority
  semantics (§3, FR20), not a bug.
- **Status:** documented; recommended behavior below. Related to but **not covered by** finding
  [0003 — README accuracy](0003-readme-accuracy.md) (that was about README gaps; this is about the
  reporting principle for symmetric doc↔code disagreement). No changes implemented.

## Observed behavior

A reconcile run surfaced a **documentation-vs-implementation mismatch** — a doc referencing
`${CLAUDE_SKILL_DIR}` while the implementation resolves `${CLAUDE_PLUGIN_ROOT}` →
`${NIGHTWATCH_ROOT}` (`docs/install.md`, the command specs). Surfacing it is a **good** finding. But
the proposed remedy was a patch aligning the **doc to the code** — i.e. it implicitly treated the
**implementation as authoritative** and the documentation as the thing to fix.

## Why this matters

- **Neither side is inherently canonical.** When documentation and implementation disagree and no
  `STATE.md` `authority:` block declares which artifact wins, "patch the doc to match the code"
  assumes an answer the tool does not have. The code could be the bug; the doc could be the intended
  contract. Silently picking the code erodes the "declarations over inference / never guess"
  principle the reconciler rests on.
- **Today's behavior is close but still implicitly directional.** Without declared authority,
  reconcile "detects conflicts but omits direction-of-fix" (§3/FR20) — good — yet if it still emits
  an alignment patch, that patch encodes a direction (align to code) the tool was not told to pick.
- **The ambiguity should be named, not resolved by default.** The honest output is "these two
  disagree and I can't tell which is right," surfaced explicitly — so the human (or a `STATE.md`
  authority declaration) resolves it, rather than the tool quietly canonizing one side.

## Risks

- A correct doc gets "fixed" to match buggy code (or vice versa), laundering a real defect into an
  apparent agreement.
- Users trust patches that silently assume authority the tool never had.

## Suggested improvements

1. **Add an explicit `contract-ambiguity` finding kind/label** for doc↔implementation disagreements
   where authority does not resolve which side is canonical.
2. **Report both sides symmetrically** — "doc says X (`path:line`); code does Y (`path:line`)" — with
   **no implied direction-of-fix**.
3. **Keep any proposed patch advisory** and clearly marked *"requires an authority declaration to
   choose a direction"* — never applied or framed as the fix by default.
4. **Resolution is a declaration, not an inference:** the fix is declaring `authority:` in
   `STATE.md` (or a human decision), which then legitimately yields direction-of-fix — consistent
   with FR20 and the "declarations over inference" principle. Make the ambiguity explicit until then.
