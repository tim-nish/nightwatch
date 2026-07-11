# Dogfooding finding 0025 — Bare cross-references are indistinguishable between repos, and nothing guards against Nightwatch leaking its own state into a target repo's brief

- **Date:** 2026-07-11
- **Session:** dogfooding — round-2 review of the roadmap-first MORNING prototype
  ([feedback record](../prototypes/MORNING-2026-07-11-feedback.md), point 2). The
  maintainer suspected the brief was mixing Nightwatch's own project state into the
  writing-assistant report.
- **Command:** none — concerns any brief/tracker surface that cites issues, PRs, or
  commits; and the judgment layer's isolation from the plugin's own repository.
- **Classification:** trust / correctness-adjacent. The suspicion was a **false alarm on
  the specific facts** — but a *reasonable* one, which is itself the finding: a report
  whose references can't be verified at a glance costs the exact trust and attention the
  product exists to protect.
- **Status:** documented, investigation complete; guard proposals below.

## What the maintainer reported

> The prototype says "Epics 7 and 8 fully merged (8 PRs, #78–#85)". However, the target
> repository (writing-assistant) only has issues up to #74. Those numbers match the
> Nightwatch repository instead. Please investigate whether MORNING.md is accidentally
> mixing Nightwatch's own project state with the target repository being reviewed.

## Investigation (verified against GitHub, 2026-07-11)

**No mixing occurred; the numbers are writing-assistant's own.** Verified:
writing-assistant PRs **#75–#85 all exist and are exactly the Epic 7/8 story merges**
cited (e.g. #78 "Story 7.4: stage-0 configuration validation" … #85 "Story 8.5:
platform-variant visual rendering"), matching its local merge commits.

**Why the maintainer's check said otherwise:** GitHub issues and PRs share one number
sequence per repo. writing-assistant's *issues* stop at **#74** (issue #74 = "Story 8.5")
because **#75–#85 were consumed by the PRs** — the issues tab alone cannot refute a PR
number.

**Why the suspicion was nevertheless reasonable — the trap is real:** both repositories
ran *parallel* "Epic 7 / Epic 8" story sequences with near-identical story names and
overlapping PR ranges in the same week (nightwatch: story 7.4 → PR #77, stories 8.1–8.5 →
PRs #86–#90; writing-assistant: story 7.4 → PR #78, stories 8.1–8.5 → PRs #81–#85). For a
maintainer of both repos, a bare `#78` is genuinely ambiguous. The report gave no way to
tell — and a report that *could* have leaked is nearly as damaging as one that did,
because the reader now audits every number.

## Two distinct gaps

1. **Reference ambiguity (presentation).** Nothing in the brief/tracker grammar requires
   a reference to be self-evidently about the target repo. Bare `#N` invites exactly this
   morning's doubt whenever the maintainer runs sibling projects.
2. **No own-state isolation guard (behavior).** The judgment layer runs as an agent that
   may well have Nightwatch's own repo in context (dogfooding makes this the *common*
   case, not the edge case). No prompt rule, lint, or verification step asserts "never
   cite state that isn't the target repository's." This time the citation was clean;
   nothing but luck and prompt discipline makes it so next time.

## What this suggests (observations, not yet design)

- **Self-evident references (harness rule, cheap):** cite title-first with the number
  parenthesized — *"Story 7.4: stage-0 configuration validation (PR #78)"* — or prefix
  the repo (`writing-assistant#78`) whenever a number appears. Never a bare `#N`.
- **Deterministic reference check (script-layer, no network):** every PR/commit number a
  brief cites is verifiable against the target repo's own git history (`Merge pull
  request #N …` merge commits) — a collector-side lint can reject or flag citations that
  match nothing local, which would also have *proven* the numbers' provenance this
  morning instead of requiring a manual investigation.
- **Own-state isolation rule (spec-level):** an explicit judgment-layer contract — the
  report may reference only artifacts under the target repo root — restated in every
  member-job prompt, with the adversarial pass instructed to refute any citation it
  cannot locate in the target repo.

## Next step

Fold the reference grammar into the writing-harness spec (rule W2 in the
[prototype feedback record](../prototypes/MORNING-2026-07-11-feedback.md)) and the
isolation rule + deterministic reference check into the same spec's verification section
(or `finding-lifecycle.md` if that spec grows a general citation-integrity clause).
