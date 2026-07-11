# Dogfooding finding 0023 — Every generated document needs an explicit, testable primary objective — declared before its writing harness is designed

- **Date:** 2026-07-11
- **Session:** dogfooding — *writing-assistant* round continued; direct refinement of
  [0022](0022-writing-harness.md) (writing harness), supplying the layer 0022 left
  implicit.
- **Command:** none — governs all generated document surfaces (`MORNING.md`,
  `RELEASE.md`, and any future one).
- **Classification:** output quality / generation design — the governing criterion for
  the harness. Sequencing directive included: objective first, harness second.
- **Status:** documented; verbatim user feedback with review analysis.

## The feedback (user's own framing)

> Each generated document should have a clearly defined Primary Objective before its
> writing harness is designed. For example, the primary objective of MORNING.md should
> be: **allow the maintainer to begin productive work within 3 minutes of opening
> MORNING.md.** Every section, paragraph, and sentence should be evaluated against that
> objective. If a piece of information does not help the maintainer decide what to do
> next or start working more quickly, it should either be removed, moved to a less
> prominent section, or placed in an appendix. The current documents optimize for
> recording execution history rather than helping the reader make decisions. Defining an
> explicit primary objective for each document would provide a much stronger writing
> harness and make it easier to judge whether generated content belongs in the document.

## Review analysis

**The product already has this objective — as prose, not as a criterion.** The README
("the maintainer wakes up, opens one file, and knows what to do — even when mentally
exhausted") and principle 2 ("an unread report is negative value") state the intent;
finding 0016 judged the brief against it. But nowhere is it operationalized as a test
that generated *content* must pass. The user's contribution is making it **falsifiable**:
"begin productive work within 3 minutes" is a bar a dogfooding session can time — 0016's
"after reading it, I still did not know the concrete next action" becomes a measured
failure instead of an impression.

**The 30-second contract (FR55) is a partial precedent — this generalizes it.** FR55
already binds the *top* of the brief to a time budget (status, first action, position
above the fold). The primary objective extends the same discipline from "what must be
above the fold" to *every sentence in the document*: an inclusion/exclusion criterion,
not just an ordering rule.

**The removal rule is principle 2, made per-sentence.** "Doesn't help the decision →
remove / demote / appendix" is exactly the caps-and-appendix logic that already governs
*findings* (NFR7), applied for the first time to *prose and sections*. The mechanism is
proven; only its scope was too narrow.

**Why the objective must precede the harness (the sequencing directive).** 0022 proposes
per-section reader-questions and grammar rules. Without a document-level objective, those
section contracts have no arbiter — nothing decides whether a section belongs at all.
The hierarchy this feedback fixes: **primary objective (per document) → section
reader-questions (derive from it) → sentence grammar (serves the questions)**. Each layer
evaluable against the one above; content that serves no reader-question serves no
objective and exits the document.

**Primary objectives are product decisions, so they must be declared, not improvised**
(principle 5's spirit applied to Nightwatch's own outputs): a short objectives table in
the writing-harness spec — one falsifiable sentence per document — versioned like the
caps. Candidate wording, for triage rather than adoption:

| Document | Candidate primary objective |
|---|---|
| `MORNING.md` | The maintainer begins productive work within 3 minutes of opening it. |
| `RELEASE.md` | The maintainer can state the release goal, their current position, and the next milestone within 1 minute of opening it (0021's journey). |

**Testability closes the loop.** With a declared objective, the adversarial pass gains
the criterion 0022 wanted for its "reader-question check," dogfooding sessions get a
pass/fail bar, and NFR-style acceptance criteria become writable ("a first-time reader
reaches a concrete next action within N minutes on the fixture repo").

## Why this matters

- It converts the round's diagnosis (0020–0022: "optimizes for execution history, not
  decisions") into a single enforceable rule instead of a list of per-surface fixes.
- It gives every future "should the brief include X?" debate a resolution procedure —
  measured against the objective, not argued from taste.

## Next step

Fold into the writing-harness spec (0022's next step) as its **first section**: the
per-document primary-objectives table, declared before any section contract. The harness
spec's acceptance criteria should include at least one timed objective test per document.
