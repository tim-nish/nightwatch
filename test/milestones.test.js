'use strict';
// Story 10.3 — `milestones:` declaration & validation (spec release-journey P1). The maintainer
// declares an ordered milestones list over their existing definition of done; a milestone is done
// iff all its referenced criteria are done, current is the first non-done, next the one after, and
// file order is the journey order. Validation is declared-not-inferred: dangling references and
// unreferenced DoD items each surface a setup finding; init --update drafts a block on confirmation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write, readFile, gitInit, commit } = require('./helpers');
const {
  parseMilestones, validateMilestones, milestoneFindings, deriveJourney, draftMilestones,
} = require('../scripts/lib/milestones');
const { planUpdate, applyMilestonesDraft } = require('../scripts/lib/init');
const { loadConfig } = require('../scripts/lib/config');

const REL = (extra) => Object.assign({
  target: 'v1',
  definition_of_done: ['crit A', 'crit B', 'crit C'],
}, extra);
const MS = [
  { name: 'M1', criteria: ['crit A'] },
  { name: 'M2', criteria: ['crit B'] },
];

module.exports = {
  // ---- parse + done/current/next derivation -------------------------------------------------
  'milestones: parse keeps file order and drops nameless entries': () => {
    const parsed = parseMilestones({ milestones: [{ name: 'M1', criteria: ['a'] }, { criteria: ['b'] }, { name: 'M2' }] });
    assert.deepStrictEqual(parsed.map((m) => m.name), ['M1', 'M2'], 'file order, nameless dropped');
    assert.deepStrictEqual(parsed[1].criteria, [], 'missing criteria → empty');
  },

  'milestones: a milestone is done iff all its criteria are done; current is first non-done, next the one after': () => {
    const done = new Set(['crit A']); // M1 done, M2 not
    const j = deriveJourney(REL({ milestones: MS }), (c) => done.has(c));
    assert.deepStrictEqual(j.milestones.map((m) => [m.name, m.done, m.mark]), [['M1', true, '✓'], ['M2', false, '▶']]);
    assert.strictEqual(j.currentIndex, 1, 'M2 is current');
    assert.strictEqual(j.nextIndex, -1, 'no milestone after the last');
    // Unreferenced DoD items ("crit C") come back for the "(not yet on the road)" group.
    assert.deepStrictEqual(j.unreferenced, ['crit C']);
  },

  // ---- validation: declared-not-inferred ----------------------------------------------------
  'milestones: a dangling criterion and an unreferenced DoD item each surface one setup finding': () => {
    const rel = REL({ milestones: [{ name: 'M1', criteria: ['crit A', 'crit MISSING'] }] });
    const v = validateMilestones(rel);
    assert.deepStrictEqual(v.dangling, [{ milestone: 'M1', criterion: 'crit MISSING' }]);
    assert.deepStrictEqual(v.unreferenced, ['crit B', 'crit C']);
    const findings = milestoneFindings(rel);
    assert.strictEqual(findings.length, 3, 'one dangling + two unreferenced');
    assert.ok(findings.every((f) => f.kind === 'setup'));
    assert.ok(findings.some((f) => /crit MISSING.*not in `definition_of_done`/.test(f.title)));
    assert.ok(findings.some((f) => /crit B.*not yet on the road/.test(f.title) || /not yet on the road/.test(f.title)));
  },

  'milestones: absent milestones with a DoD → exactly one "declare milestones" nudge; no DoD → none': () => {
    const nudge = milestoneFindings(REL());
    assert.strictEqual(nudge.length, 1);
    assert.match(nudge[0].title, /declare `milestones:`/);
    assert.strictEqual(milestoneFindings({ target: 'v1' }).length, 0, 'no DoD → no nudge');
    assert.strictEqual(milestoneFindings(null).length, 0, 'no release block → nothing');
  },

  'milestones: a fully-referenced declaration emits no findings (deterministic)': () => {
    const rel = REL({ definition_of_done: ['crit A', 'crit B'], milestones: MS });
    assert.deepStrictEqual(milestoneFindings(rel), []);
  },

  // ---- init --update drafter ----------------------------------------------------------------
  'milestones: draftMilestones builds one milestone per DoD item; init --update proposes it when absent': () => {
    const draft = draftMilestones(REL());
    assert.match(draft, /^milestones:/);
    assert.ok(draft.includes('- name: "crit A"') && draft.includes('criteria: ["crit A"]'));
    assert.strictEqual(draftMilestones({ target: 'v1' }), null, 'no DoD → nothing to draft');

    const r = tmpRepo();
    gitInit(r);
    write(r, '.nightwatch/STATE.md', '# s\n```yaml\nrelease:\n  target: "v1"\n  definition_of_done:\n    - "crit A"\n    - "crit B"\n```\n');
    commit(r, 'state with DoD, no milestones');
    const plan = planUpdate(r);
    const prop = plan.proposals.find((p) => p.kind === 'milestones');
    assert.ok(prop, 'a milestones draft is proposed');
    assert.match(prop.block, /milestones:/);
  },

  'milestones: applyMilestonesDraft inserts the block under release:, byte-preserving the rest; idempotent': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, '.nightwatch/STATE.md', '# mine\n```yaml\nrelease:\n  target: "v1"\n  definition_of_done:\n    - "crit A"\n```\n');
    const res = applyMilestonesDraft(r, draftMilestones({ definition_of_done: ['crit A'] }));
    assert.strictEqual(res.changed, true);
    // The declaration now parses with a milestone referencing the DoD item.
    const lc = loadConfig(r);
    const parsed = parseMilestones(lc.release);
    assert.deepStrictEqual(parsed.map((m) => m.name), ['crit A']);
    assert.deepStrictEqual(parsed[0].criteria, ['crit A']);
    // Human content preserved; re-running is a no-op.
    assert.ok(readFile(r, '.nightwatch/STATE.md').startsWith('# mine\n'));
    assert.strictEqual(applyMilestonesDraft(r, draftMilestones({ definition_of_done: ['crit A'] })).changed, false, 'idempotent');
  },
};
