# Prototype feedback — MORNING-2026-07-11 (roadmap-first), round 2

- **Date:** 2026-07-11
- **Artifact under review:** [`MORNING-2026-07-11.md`](MORNING-2026-07-11.md), read cold by
  the maintainer as the morning's first document.
- **Verdict:** clear improvement; "The road to release" validated as the centerpiece. But
  the document still reads as *Nightwatch's perspective* (execution narrator) rather than
  the *maintainer's* (work briefing), and quality decays after the road section.
- **Disposition:** ten points below, each with a review verdict and the harness rule it
  produces. Rules are folded into
  [`objectives-and-prior-art.md`](objectives-and-prior-art.md) §3b; point 2 became
  dogfooding finding [0025](../dogfooding/0025-repo-context-ambiguity.md).

## Point-by-point

**1. Hard line-wrapping breaks scanning.** Sentences wrapped mid-clause at the authoring
column width. Verdict: authoring artifact, but a real contract gap — the reader consumes
the raw file. → **Rule W1:** generated morning documents never hard-wrap inside a
sentence; one bullet = one source line; let the viewer soft-wrap.

**2. "PRs #78–#85 look like Nightwatch's numbers, not writing-assistant's."** Investigated
and resolved — see finding **0025**: the numbers are correct (writing-assistant PRs
#75–#85 exist; its *issues* stop at #74 because GitHub issues and PRs share one number
sequence), and no state mixing occurred. But the doubt was reasonable: both repos ran
parallel "Epic 7/8" story sequences with near-identical names and overlapping PR ranges.
→ **Rule W2:** no bare `#N` references — every issue/PR reference is self-evidently about
the target repo (title-first, number parenthesized). Plus the 0025 leak-guard proposals.

**3. "The road to release" is dramatically better.** Validated: milestone visualization,
obvious current position, clear goal. → Keep as the composition's centerpiece; the
harness spec should treat it as the load-bearing section.

**4. The roadmap stops at "you are here".** The reader wants the *chain*: current task →
current milestone → next milestone → following — how today's work feeds the journey. The
prototype listed later items (hygiene gate, 🏁) but never connected today's task forward.
→ **Rule W3:** the road always renders at least the next and following milestones, and
each action states — in words, not arithmetic — which milestone it advances and what
becomes possible when that milestone closes.

**5. Sentences without a communication contract.** "2 min, finishes half of milestone 3":
unexplained estimate, unanchored ordinal, unexplained fraction. "(generic checks, not
your definition of done)": purpose unclear. → **Rule W4:** no unexplained arithmetic or
derived quantities; milestones are referred to by *name*, never number; every
parenthetical must answer a nameable reader question or be cut; effort estimates carry
their basis or are dropped.

**6. "Two small gaps left" vs "Blocking the release: nothing."** The reader cannot tell
whether gaps are blockers. Near-synonyms (gap/blocker/remaining) were used without
relating them. → **Rule W5:** one declared category vocabulary — *blocker* (stops the
release), *remaining work* (inside the current milestone), *waivable gate* (optional),
*later milestone* — used exactly and exclusively; a sentence that introduces a new noun
for work must map it to one category.

**7. Quality break at "First action"; "who is the checkbox for?"** The register shifts
from briefing prose to terse generated-output style, and the checkbox affordance is
unexplained until the footer. Telling detail: the checkbox's own designer asked whom it
serves. → **Rule W6:** one register for the whole document; the feedback affordance is
explained at (or before) its first use, and roadmap progress marks (✓ ▶ ○) must be
visually distinct from feedback checkboxes (`[ ]`).

**8. "A variable no skill uses" assumes yesterday's context.** The morning document
exists precisely because the reader has *lost* context overnight; it must restore it, not
presume it. → **Rule W7:** every action is self-contained — readable by someone who has
not thought about the issue since yesterday: what to change, why it matters, expected
outcome.

**9. Consistency decays toward the end** — formatting, style, and detail level drift
section by section ("written by different systems" — accurate: the tail reused fragments
of the current generated style). → **Rule W8:** the writing harness governs the *entire*
document, not the lead sections; the style contract (register, tense, formatting) is
per-document, with mechanical checks where possible.

**10. Details still explains findings, not work.** Provenance ("its patch was lost in
the forced re-run") crowds out execution. → **Rule W9:** Details entries follow a
work-briefing template — *What exactly to change / Why the change is necessary / What
outcome to expect (and how to verify it)* — with discovery provenance and run history
relegated to the appendix/machine notes.

## Overall

The structural bet (road-first) held; the writing did not. The next prototype iteration
(or the first harness-governed generation) must pass the per-sentence primary-objective
test: *does this sentence move the maintainer toward productive work within 3 minutes?*
Perspective inversion is the summary rule — write as the maintainer's chief of staff,
never as the tool's narrator.
