'use strict';
// Story 10.4 — RELEASE.md journey: the road, journey order & "What changed lately" (spec
// release-journey P2/P3, FR84/FR85). RELEASE.md opens with the road (goal + ✓ ▶ ○ marks re-derived
// every run), sections re-order to v2, blockers/remaining fold into the road, and history reads as
// impact. Byte-deterministic; an untouched document returns its original bytes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write, readFile, gitInit, commit } = require('./helpers');
const { openTracker, renderRoad } = require('../scripts/lib/tracker');
const { DEFAULTS } = require('../scripts/lib/config');
const { releaseProgress } = require('../scripts/release-progress');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'templates', 'RELEASE.md'), 'utf8');
const JOURNEY = {
  goal: 'First release — all epics complete',
  milestones: [
    { name: 'Foundations', criteria: ['a'], done: true },
    { name: 'Pipeline proven', criteria: ['b', 'c'], done: false },
    { name: 'Docs validated', criteria: ['d'], done: false },
  ],
  currentIndex: 1, nextIndex: 2, unreferenced: [], blockers: [],
};

module.exports = {
  // ---- the road block (spec P2) -------------------------------------------------------------
  'road: opens with the goal, ✓ ▶ ○ marks, current expanded, later as orientation, gate, 🏁, blockers': () => {
    const road = renderRoad(Object.assign({}, JOURNEY, { blockers: ['a sev-1 finding'] }));
    assert.match(road, /^## The road/);
    assert.match(road, /\*\*Goal \(yours, declared in STATE\.md\):\*\* First release — all epics complete/);
    assert.match(road, /- ✓ \*\*Foundations\*\*/, 'done milestone marked ✓');
    assert.match(road, /- ▶ \*\*Pipeline proven\*\* — \*current milestone\.\*/, 'current milestone marked ▶ and expanded');
    assert.ok(road.includes('  - b') && road.includes('  - c'), 'current milestone criteria expanded as work');
    assert.match(road, /- ○ \*\*Docs validated\*\*/, 'later milestone marked ○');
    assert.match(road, /Hygiene gate before tagging.*waivable gate/, 'waivable hygiene gate present, not interleaved');
    assert.match(road, /- 🏁 \*\*Tag the release\.\*\*/, '🏁 line present');
    assert.match(road, /\*\*Blocked by:\*\* a sev-1 finding/, 'blockers line');
  },

  // ---- marks re-derive every run (spec P2/FR84) ---------------------------------------------
  'road: a completed criterion flips ▶ → ✓ and advances current — marks are re-derived, never stored': () => {
    const before = renderRoad(JOURNEY);
    assert.match(before, /- ✓ \*\*Foundations\*\*[\s\S]*- ▶ \*\*Pipeline proven\*\*/, 'Pipeline is current');
    // b and c complete → Pipeline done, current advances to Docs (a fresh journey, same milestones).
    const after = renderRoad({
      goal: JOURNEY.goal,
      milestones: [
        { name: 'Foundations', criteria: ['a'], done: true },
        { name: 'Pipeline proven', criteria: ['b', 'c'], done: true },
        { name: 'Docs validated', criteria: ['d'], done: false },
      ],
      currentIndex: 2, nextIndex: -1, unreferenced: [], blockers: [],
    });
    assert.match(after, /- ✓ \*\*Pipeline proven\*\*/, '▶ → ✓ after its criteria complete');
    assert.match(after, /- ▶ \*\*Docs validated\*\* — \*current milestone\.\*/, 'current advanced to the next milestone');
  },

  // ---- section order v2 + folding (spec P3) -------------------------------------------------
  'road: with a journey, sections order to v2 and blockers/remaining fold into the road': () => {
    const r = tmpRepo();
    const t = openTracker(r, DEFAULTS);
    t.upsertItem({ key: 'b1', title: 'a release blocker', section: 'blockers' });
    t.upsertItem({ key: 'i1', title: 'stray impl item', section: 'implementation' });
    t.setJourney(Object.assign({}, JOURNEY, { blockers: undefined, unreferenced: [] })); // let the tracker fold from items
    t.flush();
    const out = readFile(r, '.nightwatch/RELEASE.md');
    // Journey order: The road → Next actions → Human decisions → What changed lately → Done → Nice → Phase → Notes.
    const order = ['## The road', '## Next actions', '## Human decisions needed', '## What changed lately', '## Done', '## Nice to have', '## Phase', '## Notes'].map((h) => out.indexOf(h));
    assert.ok(order.every((i) => i >= 0), 'every v2 section present');
    for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `section ${i} follows ${i - 1}`);
    // Folded: no Release blockers / Remaining headings; their items surface in the road instead.
    assert.ok(!out.includes('## Release blockers') && !out.includes('## Remaining —'), 'blocker/remaining headings folded away');
    assert.match(out, /\*\*Blocked by:\*\* a release blocker/, 'blocker item folded into the road line');
    assert.match(out, /\(not yet on the road\)[\s\S]*stray impl item/, 'stray impl item folded under "(not yet on the road)"');
  },

  // ---- byte-determinism (spec NFR8) ---------------------------------------------------------
  'road: identical journey renders byte-identically; an untouched document returns its original bytes': () => {
    const mk = () => {
      const r = tmpRepo();
      const t = openTracker(r, DEFAULTS);
      t.setJourney(JOURNEY);
      t.flush();
      return readFile(r, '.nightwatch/RELEASE.md');
    };
    assert.strictEqual(mk(), mk(), 'same journey → byte-identical');
    // No setJourney, no mutation → the untouched template round-trips byte-for-byte.
    const r = tmpRepo();
    openTracker(r, DEFAULTS).flush();
    assert.strictEqual(readFile(r, '.nightwatch/RELEASE.md'), TEMPLATE, 'untouched doc returns its original bytes');
  },

  // ---- e2e: release-progress renders the road from a declared journey + impact-first history --
  'road e2e: release-progress opens RELEASE.md with the road and writes impact-first history': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, '.nightwatch/STATE.md', '# s\n```yaml\nrelease:\n  target: "v1 — ship it"\n  definition_of_done:\n    - "docs done"\n  milestones:\n    - name: "Docs complete"\n      criteria: ["docs done"]\n```\n');
    commit(r, 'state with milestones');
    releaseProgress(r, { date: '2026-07-10' });
    const out = readFile(r, '.nightwatch/RELEASE.md');
    assert.match(out, /## The road/, 'RELEASE.md opens with the road');
    assert.match(out, /\*\*Goal \(yours, declared in STATE\.md\):\*\* v1 — ship it/, 'goal verbatim + attributed');
    assert.match(out, /- ▶ \*\*Docs complete\*\*/, 'the declared milestone renders as current');
    assert.ok(!/— no change|completed:|forced re-run/.test(out), 'history is impact-first, never a run log');
  },
};
