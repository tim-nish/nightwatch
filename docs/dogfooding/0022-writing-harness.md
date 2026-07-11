# Dogfooding finding 0022 — The generated prose has no communication objective; the writer needs a harness

- **Date:** 2026-07-11
- **Session:** dogfooding — *writing-assistant*, reading `MORNING.md` and `RELEASE.md`
  prose (same round as 0020/0021).
- **Command:** the prose-producing surfaces of `release-progress` (status entries, item
  text) and the brief-feeding judgment layers.
- **Classification:** output quality / generation design. Systemic: 0016–0021 each caught
  a *symptom* (density, ordering, missing blocks); this finding names the *cause* — no
  writing guidance exists anywhere in the generation path — and records the user's
  requested remedy: a dedicated writing harness.
- **Status:** documented; verbatim user feedback with review analysis.

## The feedback (user's own framing)

> For example, this sentence: *"2026-07-10 — forced re-run: progress unchanged…"* does not
> tell me why I should care. I don't know: Who is this written for? What decision is it
> helping me make? What action should I take after reading it? It feels like a
> chronological execution log rather than a morning briefing. Every paragraph should
> answer a concrete question the maintainer is likely to have after opening the document.
>
> Rather than generating raw summaries from execution logs, I think Nightwatch should have
> a dedicated writing harness for both MORNING.md and RELEASE.md. I recommend studying
> successful existing products that generate project summaries or planning documents, then
> designing a writing harness around those patterns. The objective should not simply be to
> summarize execution results, but to produce documents that genuinely help a maintainer
> decide what to do next. The morning report should optimize for clarity, prioritization,
> and next actions, not for preserving execution history.

## Review analysis

**The quoted sentence is log-speak *by spec*.** §5 says "append one status line" — the
status entry is specified as an execution record, and that is exactly what it reads as.
The 2026-07-11 entry (RELEASE.md line 10) is a 90-word single sentence packing five
subjects (re-run, findings counts, RC-615fba state, hygiene, arch candidates) — factually
excellent (it caught the 0019 contradiction), communicatively unranked. The information
survives; the *reader's question* it answers was never defined.

**Where the spec DID define a writing contract, the output is good — that's the
existence proof.** `next_step.summary` has a grammar (imperative, verb-first, ≤ 60 chars,
FR54) and its action lines read well ("Apply the ready-made README fix"). The status
lines, item text, and section prose have *no* contract, and they default to logs. The
delta between the two is the whole finding: prose quality tracks the presence of a
per-surface writing contract, not model capability.

**Why a harness and not just more prompts.** Nightwatch's architecture already splits
deterministic assembly (scripts, NFR8) from judgment (prompts). Prose is judgment-layer —
so the harness is: (a) a **per-surface communication contract** (audience, the concrete
reader-question each block answers, length/grammar rules, forbidden content) declared once
and injected into every prose-producing prompt, plus (b) **deterministic enforcement**
where checkable (length caps, verb-first checks, banned-pattern lints — collector-side,
like the caps). Verification symmetry: findings pass an adversarial pass for *truth*;
prose currently passes nothing for *usefulness* — a harness can add a "reader-question
check" (does this line answer its assigned question?) to the same verify step.

**Constraints any harness must respect** (so the redesign doesn't regress shipped
invariants): byte-determinism of assembly (NFR8 — judgment writes fields, scripts compose
them), the caps/attention model (NFR7), checkbox/id manifests (FR58/FR60), byte-preserved
human content (FR17), and the honest-counts rules (0010/0014).

**Per the user's direction, study prior art before designing.** Candidate patterns worth
mining: daily-standup formats (yesterday/today/blockers — exactly 0020's three questions),
changelog conventions (Keep a Changelog's audience-first rules), status-update products
(Linear/Basecamp-style project updates: goal-delta-next framing), and executive-brief
patterns (answer-first, detail-on-demand — which the fold already implements
structurally). The harness spec should cite what it borrows.

## What this suggests (observations, not yet design)

- One **writing-contract document per surface** (brief, tracker) declaring: reader, the
  question each section answers, tone/grammar rules, and what must never appear
  above the fold — versioned in the repo like the caps are.
- Rewrite the **status entry contract** from "append one status line" to "answer: what
  changed since yesterday, and does it need you?" — the 0019 re-run entry rewritten under
  that contract would have led with "RC-615fba is still unfixed and its patch is gone —
  one manual edit needed," which is the sentence the user actually needed that morning.
- **Prose lint in the collector** for the mechanical rules; **reader-question check in
  the adversarial pass** for the judgment ones.

## Next step

This is the umbrella for the round: spec a writing harness (candidate:
`docs/specs/writing-harness.md`) with a prior-art survey as its first section, then let
0018/0020's orientation blocks and 0021's journey block be *authored under* that harness
rather than specced as isolated formats. Triage together.

**Refined by [0023](0023-document-primary-objective.md):** before any section contract is
written, the harness spec must open with a per-document **primary objective** — the
falsifiable criterion every section contract derives from and every sentence is judged
against.
