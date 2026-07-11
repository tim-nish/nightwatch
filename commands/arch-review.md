---
description: Review architecture for drift, unnecessary abstraction, duplication, hidden coupling, layering violations, and overengineering (weekly). Proposals only; code is never modified.
argument-hint: "[--repo .] [--force]"
---

# /arch-review

You review the host repo's architecture for drift, unnecessary abstraction, duplicated
responsibility, hidden coupling, layering violations, and overengineering. **Proposals only —
code is never modified, and you write nothing outside `.nightwatch/`.**

## Script root resolution

Every script and template path below is relative to the Nightwatch root. Resolve it once,
before running anything, and call the result `${NW_ROOT}` for the rest of this file:

1. If `${CLAUDE_PLUGIN_ROOT}` is set, use it (official plugin install).
2. Else if `${NIGHTWATCH_ROOT}` is set, use it (local/symlink install — see `docs/install.md`).
3. Else if the orchestrator launched you and supplied a Nightwatch root in your prompt, use that
   (a scheduled `/nightwatch` run resolves the root once and hands it to each member job) — this is
   the normal overnight path, and neither env var need be set in the subagent's environment.
4. Else stop and report: "Nightwatch root not found — set `NIGHTWATCH_ROOT` to the plugin directory
   (see docs/install.md) or install Nightwatch as a Claude Code plugin." Do not guess a path.

## Deterministic layer

```
node ${NW_ROOT}/scripts/arch-review.js --repo .
```
This runs the **deterministic scaffolding** (`${NW_ROOT}/scripts/arch-review.js`, exporting
`archReview(root)`). It consumes the signals below, assembles architecture **candidates**, and
for each one:

- applies the **corroboration rule** — an `exact` signal grounds a candidate on its own; a
  `heuristic` signal grounds one **only with corroboration** (a second *independent* signal —
  different source — about the same locus), otherwise the candidate is marked
  `needs_corroboration` and ranks lower;
- estimates a **blast radius** `{files, tests, public_surface}` deterministically from the
  candidate's evidence and the surface inventory;
- lays out a **both-sides argument** scaffold (`argument.for` / `argument.against`) for you to fill;
- ranks candidates **phase-aware** and splits them into a capped brief section plus an appendix.

It emits `arch-review-<date>.json` with every candidate as an `arch`/`decision` finding whose
`verified` is **false** — the script never decides. Your job is the judgment below.

To inspect the raw signals directly:
```
node ${NW_ROOT}/scripts/arch-signals.js --repo .
```
Read `.nightwatch/runtime/out/arch-signals-<date>.json`. Signal classes:
- *Speculation* — interfaces/protocols/ABCs with ≤1 implementer, single-caller indirection,
  config keys read nowhere. (Extractor-dependent; skipped with a `degraded` notice when the
  language has no extractor.)
- *Duplication* — same names/signatures across modules; heavy import-set overlap.
- *Hidden coupling* — files co-changing across module boundaries (pure git, always available).
- *Layering* — dependency edges violating declared `layers:` rules. **Only when declared**;
  otherwise reported as not-configured, never inferred.
- *Growth* — churn/size hotspots; hotspots absent from the declared architecture doc (only when
  `authority.architecture` exists).

## Judgment layer — for each candidate

The scaffolding has already grouped signals into candidates, applied the corroboration rule,
sized the blast radius, and ranked by phase. This is **your** work — the judgment the script
deliberately does not do:

1. Read the declared architecture authority doc if any. An abstraction that document *mandates*
   is `keep` even at one implementation — **cite the section, do not argue around it**. (The
   scaffolding flags a likely mandate as `mandated: true`; confirm it against the actual section.)
2. Fill the **both-sides argument** ("earns its keep because… / speculative because…") before a
   verdict: `keep` / `simplification-candidate` / `decision-needed`. Replace the placeholder
   `argument.for` / `argument.against` with real reasoning grounded in the evidence.
3. A candidate marked `needs_corroboration: true` rests on a single heuristic signal — either
   find the corroborating second signal (a targeted code read) or drop it; do **not** promote an
   uncorroborated heuristic into the brief.
4. **Adversarial refute pass (normative):** dispatch a **second subagent** whose sole job is to
   *refute* each candidate — argue the abstraction is justified, the duplication is coincidental,
   the coupling is intentional. A candidate is set `verified: true` **only if it survives** that
   refutation. **Only verified candidates enter the morning brief;** everything else stays in the
   findings doc for the record but is never shown as a proposal.
5. Trust the deterministic **phase ranking** (`phase: prototype|building` lifts
   overengineering/speculation; `phase: hardening|released` lifts drift and coupling; no phase →
   neutral) and the **cap + appendix** split: the top `caps.arch_candidates` (default 7) verified
   candidates are the brief; the rest are listed in the appendix **by id only**.

## Output

`${NW_ROOT}/scripts/arch-review.js` writes `.nightwatch/runtime/out/arch-review-<date>.json` for you
(schema in `${NW_ROOT}/scripts/lib/findings.js`; `kind: "arch"`, or `"decision"` for
decision-needed) and
records each finding in the ledger so recurrence is counted across runs. Every finding is stamped
`verified: false`. Your only writes are: flip `verified: true` on the candidates that survive the
adversarial refute pass. The brief collector shows **only verified candidates**, top
`caps.arch_candidates` (default 7) by the deterministic rank, each with evidence pointers and
blast radius; the overflow appendix lists ids only. Loci are content-stable (interface name +
path, module pair, or declared layer edge) so ids are byte-identical across unchanged runs (NFR8),
and nothing is ever written outside `.nightwatch/` (NFR3).

## Safety rules (normative)

- Writes nothing outside `.nightwatch/`; never modifies source.
- Never proposes removing anything the architecture authority names as intentional without
  flagging the relevant section.
- No overnight follow-up implementation — executing a simplification is a daytime session.
- Unparsable source is reported and skipped, never "fixed".
- Failure handling: no extractor → git-only signals + `degraded`; shallow history (<20 commits) →
  co-change skipped with notice; budget exhausted → partial output labeled partial.
