'use strict';
// Story 10.1 — per-surface writing contracts & prompt injection (spec writing-harness P1–P4). The
// contract (objective + section reader-questions + W1–W10) is the single canonical source every
// prose job injects verbatim; a golden fixture makes any removal or weakening of it detectable
// (AC3), and the objectives + inclusion rule + the ten style rules are asserted present (AC1).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  SURFACES, STYLE_RULES, objectiveFor, readerQuestion, styleRules, assembleContract,
} = require('../scripts/lib/writing');

const golden = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

module.exports = {
  // ---- AC1: objectives declared, each with its timed cold-read acceptance test ---------------
  'writing: MORNING and RELEASE carry their confirmed objectives + cold-read acceptance': () => {
    assert.match(objectiveFor('MORNING.md'), /productive work within 3 minutes/);
    assert.match(objectiveFor('RELEASE.md'), /goal, the current milestone, and the next milestone within 1 minute/);
    assert.match(SURFACES['MORNING.md'].acceptance, /≤ 3 minutes/);
    assert.match(SURFACES['RELEASE.md'].acceptance, /≤ 1 minute/);
    assert.strictEqual(objectiveFor('nope.md'), null, 'unknown surface has no objective');
  },

  // ---- AC2: every declared section carries the reader question it answers --------------------
  'writing: each surface section declares a non-empty reader question': () => {
    for (const surface of Object.keys(SURFACES)) {
      for (const sec of SURFACES[surface].sections) {
        assert.ok(sec.question && sec.question.length > 3, `${surface} ${sec.id} missing a reader question`);
        assert.strictEqual(readerQuestion(surface, sec.id), sec.question, 'readerQuestion resolves by id');
        assert.strictEqual(readerQuestion(surface, sec.title), sec.question, 'readerQuestion resolves by title');
      }
    }
    assert.strictEqual(readerQuestion('MORNING.md', 'no-such-section'), null);
  },

  // ---- AC1/AC3: all ten style rules present; the assembled contract matches its golden --------
  'writing: all ten style rules W1–W10 are present, in order': () => {
    assert.deepStrictEqual(STYLE_RULES.map((r) => r.id), ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10']);
    assert.strictEqual(styleRules().length, 10);
    assert.match(styleRules()[9], /chief of staff/, 'W10 perspective-inversion rule present');
  },

  'writing: assembleContract is byte-stable — the golden fixture detects any contract removal (AC3)': () => {
    assert.strictEqual(assembleContract('MORNING.md'), golden('writing-contract-morning.golden.txt'), 'MORNING contract unchanged');
    assert.strictEqual(assembleContract('RELEASE.md'), golden('writing-contract-release.golden.txt'), 'RELEASE contract unchanged');
    // The assembled block carries the objective, the inclusion rule, every reader question, and W1–W10.
    const m = assembleContract('MORNING.md');
    assert.match(m, /Objective: The maintainer begins productive work within 3 minutes/);
    assert.match(m, /Inclusion rule \(per sentence\)/);
    for (const r of STYLE_RULES) assert.ok(m.includes(`${r.id} — `), `contract carries ${r.id}`);
    for (const sec of SURFACES['MORNING.md'].sections) assert.ok(m.includes(`answers: ${sec.question}`), `contract carries ${sec.id} question`);
  },

  'writing: assembleContract throws for an undeclared surface (a prose job never runs contract-less)': () => {
    assert.throws(() => assembleContract('WHATEVER.md'), /no writing contract declared/);
  },
};
