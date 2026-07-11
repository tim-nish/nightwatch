// @ts-check
'use strict';
// writing.js — the per-surface WRITING CONTRACT (spec docs/specs/writing-harness.md P1–P4). Prose
// quality tracks the presence of a writing contract, not model capability (0022); this module is
// the single canonical source of that contract, so every prose-producing job injects the SAME
// objective, section reader-questions, and style rules W1–W10 verbatim into its prompt, and the
// adversarial pass verifies authored fields against the very question they must answer.
//
// This file ships DATA + assembly only — it spends no tokens, calls no model, and (per the spec's
// deterministic/judgment split, NFR8) is never invoked to WRITE prose. The collector's mechanical
// lints (W1/W2/vocabulary) and the adversarial reader-question check consume this contract in
// Story 10.2; the composition specs (brief-roadmap-composition, release-journey) own which sections
// exist and are the source of the reader-question tables mirrored here.

/**
 * Primary objectives (spec P1, confirmed 2026-07-11). Each carries the timed cold-read acceptance
 * test that IS its acceptance criterion — a document that fails its cold read fails the story.
 */
const SURFACES = Object.freeze({
  'MORNING.md': {
    objective: 'The maintainer begins productive work within 3 minutes of opening it.',
    acceptance: 'Timed cold read: open → first keystroke of real work, ≤ 3 minutes.',
    // Section reader-questions mirror brief-roadmap-composition P1; each section opens with its
    // answer (BLUF), and a sentence answering no declared question is cut (spec P2 inclusion rule).
    sections: [
      { id: 'status-line', title: 'Status line', question: 'is anything on fire?' },
      { id: 'since-yesterday', title: '## Since yesterday', question: 'what did I just finish?' },
      { id: 'the-road', title: '## The road to release', question: "what's the goal, where am I, what's next?" },
      { id: 'first-action', title: '## ▶ First action', question: 'what single thing do I do right now?' },
      { id: 'energy', title: '## If you have energy after that', question: 'what comes after that?' },
      { id: 'details', title: '## Details', question: 'how exactly do I do each task?' },
      { id: 'machine-notes', title: '## Machine notes — nothing to act on', question: 'what did the machine want me to know?' },
    ],
  },
  'RELEASE.md': {
    objective: 'The maintainer can state the release goal, the current milestone, and the next milestone within 1 minute of opening it.',
    acceptance: 'Timed cold read: say the goal, current, and next milestone aloud, ≤ 1 minute.',
    // Section reader-questions mirror release-journey P3.
    sections: [
      { id: 'the-road', title: '## The road', question: "what's the goal, the current milestone, and the next?" },
      { id: 'next-actions', title: '## Next actions (top 3)', question: 'what should I do next toward the release?' },
      { id: 'decisions', title: '## Human decisions needed', question: 'what decision is waiting on me?' },
      { id: 'changed-lately', title: '## What changed lately', question: 'what changed since yesterday, and does it need me?' },
      { id: 'done', title: '## Done', question: "what's already finished? (evidence appendix, below the fold)" },
      { id: 'parked', title: '## Nice to have', question: 'what did I defer?' },
    ],
  },
});

/**
 * Style rules W1–W10 (spec P3), normative for ALL generated prose (W8: whole-document governance).
 * Verbatim text — the golden fixture pins it so any silent weakening of the contract is a test
 * failure (AC3: removing the contract is detectable by fixture).
 */
const STYLE_RULES = Object.freeze([
  { id: 'W1', rule: 'No hard wraps: never wrap inside a sentence; one bullet = one source line.' },
  { id: 'W2', rule: 'Self-evident references: no bare `#N`. Cite title-first with the number parenthesized ("Story 7.4: … (PR #78)") or repo-prefixed ("writing-assistant#78").' },
  { id: 'W3', rule: 'The road continues: wherever a milestone path renders, the next and following milestones are visible, and each action names — in words — the milestone it advances and what closing it unlocks.' },
  { id: 'W4', rule: 'No unexplained derivations: no bare arithmetic ("half"), no ordinal-only milestone references ("milestone 3"), no purpose-free parentheticals; estimates state their basis or are dropped.' },
  { id: 'W5', rule: 'One work vocabulary — exact and exclusive: blocker (stops the release) / remaining work (inside the current milestone) / waivable gate (optional, generic) / later milestone.' },
  { id: 'W6', rule: 'One register, explained affordances: uniform style; interactive affordances (feedback checkboxes) explained at or before first use; roadmap marks (✓ ▶ ○) visually distinct from feedback checkboxes ([ ]).' },
  { id: 'W7', rule: 'Context restoration: every action is self-contained for a reader who has not thought about the issue since yesterday — what to change, why it matters, expected outcome.' },
  { id: 'W8', rule: 'Whole-document governance: these rules bind every section equally (quality must not decay after the lead sections).' },
  { id: 'W9', rule: 'Details are work briefings: per task — what exactly to change / why the change is necessary / what outcome to expect and how to verify it; discovery provenance and run history go to the appendix or Machine notes.' },
  { id: 'W10', rule: "Perspective inversion: write as the maintainer's chief of staff, never as the tool's narrator." },
]);

/** The declared objective for a surface, or null for an unknown surface name. */
function objectiveFor(surface) {
  const s = SURFACES[surface];
  return s ? s.objective : null;
}

/** The reader question a section must answer (spec P2), or null when the section is not declared. */
function readerQuestion(surface, sectionId) {
  const s = SURFACES[surface];
  if (!s) return null;
  const sec = s.sections.find((x) => x.id === sectionId || x.title === sectionId);
  return sec ? sec.question : null;
}

/** All ten style rules as `["W1 — …", …]` lines (used by the collector lints and prompt assembly). */
function styleRules() { return STYLE_RULES.map((r) => `${r.id} — ${r.rule}`); }

/**
 * Assemble the surface's writing contract as one verbatim block for injection into a prose-producing
 * job's prompt (spec P4.1). Deterministic (byte-stable for a surface) so a golden fixture makes any
 * removal or weakening of the contract detectable (AC3). Throws on an unknown surface — a prose job
 * must never run without a declared contract.
 * @param {string} surface e.g. `MORNING.md` @returns {string}
 */
function assembleContract(surface) {
  const s = SURFACES[surface];
  if (!s) throw new Error(`no writing contract declared for surface "${surface}"`);
  const L = [];
  L.push(`# Writing contract — ${surface}`);
  L.push('');
  L.push(`Objective: ${s.objective}`);
  L.push(`Acceptance (timed cold read): ${s.acceptance}`);
  L.push('Inclusion rule (per sentence): if removing a sentence would not slow the reader\'s path to the objective, move it below the fold, to an appendix, or out of the document.');
  L.push('');
  L.push('Sections — each opens with its answer (BLUF); a sentence that answers no declared question is cut:');
  for (const sec of s.sections) L.push(`- ${sec.title} — answers: ${sec.question}`);
  L.push('');
  L.push('Style rules (normative for every section):');
  for (const r of STYLE_RULES) L.push(`- ${r.id} — ${r.rule}`);
  L.push('');
  L.push('Author prose ONCE, as the structured fields the surface defines — never free text. Reference only artifacts of THIS repository; a citation you cannot locate under the repo root is dropped.');
  return L.join('\n') + '\n';
}

// CLI: print a surface's writing contract for verbatim injection into a prose job's prompt (spec
// P4.1). `node scripts/lib/writing.js [MORNING.md|RELEASE.md]` — defaults to MORNING.md. Zero tokens.
if (require.main === module) {
  const surface = process.argv[2] || 'MORNING.md';
  process.stdout.write(assembleContract(surface));
}

module.exports = { SURFACES, STYLE_RULES, objectiveFor, readerQuestion, styleRules, assembleContract };
