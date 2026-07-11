'use strict';
// Story 10.6 — open-set rendering, milestone tiebreak & work-briefing details (spec
// brief-roadmap-composition P4/P5/P6). The brief renders the OPEN finding set (not only tonight's),
// each carried-forward finding carrying a freshness suffix so it can never silently vanish; the
// first-action tiebreak favours work that advances the current milestone; the affordance line and
// the lifecycle arithmetic line are present.
const assert = require('assert');
const { tmpRepo, write, readFile, gitInit, commit } = require('./helpers');
const { collect } = require('../scripts/collect-brief');
const { openTracker } = require('../scripts/lib/tracker');
const { writeFindings } = require('../scripts/lib/findings');

module.exports = {
  // ---- P4: the brief renders the open set, with freshness ------------------------------------
  'open-set: a carried-forward open finding not re-observed still surfaces with a freshness suffix': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'README.md', 'line one\n--flag still documented\nline three\n'); commit(r, 'repo');
    // An open drift finding recorded on a prior date, citing text still present → still-open (det).
    openTracker(r, { tracking: { backend: 'markdown' } })
      .recordFindings([{ id: 'RC-carry', kind: 'drift', severity: 2, evidence: [{ path: 'README.md', line: 2 }], text: '--flag still documented' }], { date: '2026-07-09', job: 'repo-reconcile' });
    collect(r, '2026-07-10'); // no docs re-observe RC-carry
    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.ok(/--flag still documented/.test(brief), 'the carried-forward finding surfaces as an action');
    assert.match(brief, /_\(evidence still present\)_/, 'freshness suffix from the deterministic floor');
    assert.match(brief, /Findings: 0 new, 0 re-observed, 0 resolved, 1 still-open, 0 not re-examined\./, 'lifecycle arithmetic line (FR93: new count)');
  },

  // ---- P6: the affordance line under the First action ---------------------------------------
  'open-set: the First action carries the one-time feedback affordance line (W6)': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'a.js', '1\n'); commit(r, 'repo');
    writeFindings(r, 'repo-reconcile', '2026-07-10', [], [
      { id: 'RC-a', kind: 'drift', severity: 2, title: 'do the thing', evidence: [], action: 'none', verified: true },
    ]);
    collect(r, '2026-07-10');
    const first = readFile(r, '.nightwatch/MORNING.md').split('## ▶ First action')[1].split('## If you have energy')[0];
    assert.match(first, /_Tick `\[x\]` when done, `\[-\]` to dismiss — Nightwatch reads it back\._/, 'affordance line once, under First action');
  },

  // ---- P5: first-action tiebreak favours milestone-advancing work ---------------------------
  'open-set: among equals, the finding advancing the current milestone becomes the First action': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'a.js', '1\n');
    // Declare a journey whose current milestone criterion matches one finding's title.
    write(r, '.nightwatch/STATE.md', '# s\n```yaml\nrelease:\n  target: "v1"\n  definition_of_done:\n    - "advance the road"\n  milestones:\n    - name: "M1"\n      criteria: ["advance the road"]\n```\n');
    commit(r, 'state');
    // Two equal-rank, equal-severity drift findings; ids order would put RC-a first, but RC-b advances
    // the current milestone (its title === the criterion), so the tiebreak lifts it to First action.
    writeFindings(r, 'repo-reconcile', '2026-07-10', [], [
      { id: 'RC-a', kind: 'drift', severity: 3, title: 'unrelated cleanup', evidence: [], action: 'none', verified: true },
      { id: 'RC-b', kind: 'drift', severity: 3, title: 'advance the road', evidence: [], action: 'none', verified: true },
    ]);
    collect(r, '2026-07-10');
    const first = readFile(r, '.nightwatch/MORNING.md').split('## ▶ First action')[1].split('## If you have energy')[0];
    assert.ok(/advance the road/.test(first) && !/unrelated cleanup/.test(first), 'milestone-advancing finding wins the tiebreak');
  },

  // ---- caps.brief_total applies to the open set (spec P4) -----------------------------------
  'open-set: caps.brief_total bounds the open set; the rest overflow to the appendix': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'a.js', '1\n');
    write(r, '.nightwatch/config.yaml', 'caps: {brief_total: 2}\n');
    commit(r, 'repo');
    writeFindings(r, 'repo-reconcile', '2026-07-10', [], [
      { id: 'RC-1', kind: 'drift', severity: 2, title: 'one', evidence: [], action: 'none', verified: true },
      { id: 'RC-2', kind: 'drift', severity: 2, title: 'two', evidence: [], action: 'none', verified: true },
      { id: 'RC-3', kind: 'drift', severity: 2, title: 'three', evidence: [], action: 'none', verified: true },
    ]);
    const res = collect(r, '2026-07-10');
    assert.strictEqual(res.shown, 2, 'cap applies');
    assert.strictEqual(res.overflow, 1, 'the rest overflow');
    assert.match(readFile(r, '.nightwatch/MORNING.md'), /Appendix \(overflow — ids only\):\*\* `RC-3`/, 'overflow to the ids appendix');
  },
};
