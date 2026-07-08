---
description: Review architecture for drift, unnecessary abstraction, duplication, hidden coupling, layering violations, and overengineering (weekly). Proposals only; code is never modified.
argument-hint: "[--repo .] [--force]"
---

# /arch-review

You review the host repo's architecture for drift, unnecessary abstraction, duplicated
responsibility, hidden coupling, layering violations, and overengineering. **Proposals only —
code is never modified, and you write nothing outside `.nightwatch/`.**

## Deterministic layer

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/arch-signals.js --repo .
```
Read `.nightwatch/out/arch-signals-<date>.json`. Signal classes:
- *Speculation* — interfaces/protocols/ABCs with ≤1 implementer, single-caller indirection,
  config keys read nowhere. (Extractor-dependent; skipped with a `degraded` notice when the
  language has no extractor.)
- *Duplication* — same names/signatures across modules; heavy import-set overlap.
- *Hidden coupling* — files co-changing across module boundaries (pure git, always available).
- *Layering* — dependency edges violating declared `layers:` rules. **Only when declared**;
  otherwise reported as not-configured, never inferred.
- *Growth* — churn/size hotspots; hotspots absent from the declared architecture doc (only when
  `authority.architecture` exists).

## Judgment layer — for each signal

1. Read the declared architecture authority doc if any. An abstraction that document *mandates*
   is `keep` even at one implementation — **cite the section, do not argue around it**.
2. Argue **both sides** ("earns its keep because… / speculative because…") before a verdict:
   `keep` / `simplification-candidate` / `decision-needed`.
3. Attach an estimated **blast radius** to each candidate (files, tests, public surface touched)
   so the morning reader can size the work at a glance.
4. **Adversarial pass:** a second reasoning pass (ideally a subagent) attempts to refute each
   candidate; only survivors are `verified: true`.
5. Rank **phase-aware**: `phase: prototype|building` weights overengineering up;
   `phase: released` weights drift and coupling up; no phase → neutral.

## Output

Write `.nightwatch/out/arch-review-<date>.json` (schema in
`${CLAUDE_PLUGIN_ROOT}/scripts/lib/findings.js`; `kind: "arch"`, or `"decision"` for
decision-needed). Cap the brief section at `caps.arch_candidates` (default 7), ranked, each with
evidence pointers and blast radius; overflow to the appendix (ids only). Use stable `locus`
strings (e.g. the interface name + path) so ids are identical across unchanged runs.

## Safety rules (normative)

- Writes nothing outside `.nightwatch/`; never modifies source.
- Never proposes removing anything the architecture authority names as intentional without
  flagging the relevant section.
- No overnight follow-up implementation — executing a simplification is a daytime session.
- Unparsable source is reported and skipped, never "fixed".
- Failure handling: no extractor → git-only signals + `degraded`; shallow history (<20 commits) →
  co-change skipped with notice; budget exhausted → partial output labeled partial.
