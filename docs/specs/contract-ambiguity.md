# Spec: Contract ambiguity — report doc↔implementation disagreement, don't silently pick a side

- **Status:** proposed 2026-07-10 — **for review only.** Not folded into `nightwatch.md`; no FRs
  assigned; not part of Epic 7. This document captures the intended behavior for later triage.
- **Motivated by:** dogfooding finding
  [0011 — Contract ambiguity reporting](../dogfooding/0011-contract-ambiguity-reporting.md)
- **Scope:** `/repo-reconcile`'s judgment layer — how it reports a disagreement between
  documentation and implementation when no declared authority resolves which side is canonical.
  Refines the authority semantics of §3 (FR20). No change to claim extraction or verification.

## Problem

When reconcile finds a documentation claim that disagrees with the code (e.g. a doc references
`${CLAUDE_SKILL_DIR}` while the implementation resolves `${CLAUDE_PLUGIN_ROOT}` → `${NIGHTWATCH_ROOT}`),
surfacing the disagreement is correct and valuable. But the *remedy* today leans one way: it proposes
a patch aligning the **doc to the code**, implicitly treating the implementation as authoritative.
Neither side is inherently canonical — the code could be the bug, or the doc could be the intended
contract. Silently picking the code assumes an answer the tool was never given.

Today, without a declared `authority:`, reconcile "detects conflicts but omits direction-of-fix"
(§3/FR20) — good — yet if it still emits an alignment patch, that patch *encodes* a direction the
tool wasn't told to choose. The honest output is "these two disagree and I can't tell which is
right," made explicit.

## Design constraints

1. **Never guess authority.** Direction-of-fix requires a declaration (`STATE.md` `authority:`) or a
   human decision — never an implicit default toward code or docs.
2. **Declarations over inference** (§2.2 principle): an ambiguous disagreement is resolved by the
   human at declaration time, not by the tool at analysis time.
3. **Surface, don't suppress.** The disagreement must still reach the brief — as an explicit
   ambiguity, not dropped for lack of a fix direction.
4. **Backwards compatible.** When authority *is* declared for the artifact, today's behavior is
   unchanged: direction-of-fix and an advisory patch toward the authoritative side.

## Proposals

### P1 — An explicit `contract-ambiguity` finding

Add a distinct finding kind/label, **`contract-ambiguity`**, for a doc↔implementation disagreement
where no declared authority resolves which side is canonical. It is not a `drift` (which implies a
known-wrong side and a fix direction); it is "two sources of truth disagree and none is declared
authoritative."

### P2 — Report both sides symmetrically, with no implied direction

The finding states each side with evidence and takes no position on which is right:

```
contract-ambiguity: docs and code disagree on the plugin-root variable.
  doc:  docs/install.md:20 references ${CLAUDE_SKILL_DIR}
  code: resolves ${CLAUDE_PLUGIN_ROOT} → ${NIGHTWATCH_ROOT} (commands/*.md, scripts/lib/util.js)
  No authority declared for this contract — declare `authority:` in STATE.md to choose a direction.
```

No `direction-of-fix` is set; the finding action is a human/daytime decision, not an applied fix.

### P3 — Patches stay advisory and clearly conditional

Any patch the tool can compute (e.g. "align the doc to the code") may be offered **only** as an
explicitly advisory artifact, labeled *"requires an authority declaration to choose a direction"* —
never applied, never the default framing, and always paired with the equally-valid inverse
("or fix the code to match the doc"). Absent authority, reconcile emits **no** unconditional
alignment patch.

### P4 — Resolution is a declaration

The fix for the ambiguity itself is declaring `authority:` in `STATE.md` (or a human decision).
Once declared, the disagreement becomes an ordinary `drift` with a legitimate direction-of-fix and
an advisory patch toward the authoritative side — today's behavior. Until then, the ambiguity is
reported as such, every run, never silently resolved.

## Non-goals

- No automatic authority inference from heuristics (freshness, file type, "code wins"). Authority is
  declared, never guessed.
- No new verification machinery — this reuses the existing extract → verify → judgment pipeline and
  only changes how an authority-less disagreement is labeled and reported.
- No change to disagreements where authority *is* declared.

## Acceptance criteria

1. A doc↔implementation disagreement with **no** declared authority for the artifact produces a
   `contract-ambiguity` finding that names both sides with evidence and sets no direction-of-fix.
2. In that case reconcile emits no unconditional alignment patch; any patch offered is explicitly
   advisory and names the required authority declaration.
3. Declaring `authority:` for the artifact turns the same disagreement into a `drift` with
   direction-of-fix and an advisory patch toward the authoritative side (today's behavior).
4. The ambiguity is surfaced in the brief every run until resolved by a declaration; it is never
   silently dropped or auto-resolved.

## Tests

- Fixture: a doc claim disagreeing with the code, **no** `STATE.md` authority → a
  `contract-ambiguity` finding listing both sides; no `direction-of-fix`; no unconditional patch.
- Same fixture **with** `authority:` declared → a `drift` finding with direction-of-fix and an
  advisory patch toward the declared side.
- The advisory patch, when present without authority, is labeled conditional and is never applied.
