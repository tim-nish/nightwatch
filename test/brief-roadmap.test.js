'use strict';
// Story 10.5 — roadmap-first brief: Since yesterday & the road to release (spec
// brief-roadmap-composition P1–P3, FR78/FR79/FR80). Orient before triage: Since yesterday and the
// road land above the fold, before the single First action. The road renders the declared journey
// or degrades through the fallback matrix; the brief is byte-identical on identical inputs.
const assert = require('assert');
const { tmpRepo, write, readFile, gitInit, commit, git } = require('./helpers');
const { collect } = require('../scripts/collect-brief');
const { openTracker } = require('../scripts/lib/tracker');

const STATE_WITH_MILESTONES = '# s\n```yaml\nrelease:\n  target: "First release"\n  definition_of_done:\n    - "docs done"\n    - "tests green"\n  milestones:\n    - name: "Docs complete"\n      criteria: ["docs done"]\n    - name: "Tests green"\n      criteria: ["tests green"]\n```\n';

module.exports = {
  // ---- ## Since yesterday (spec P2) ---------------------------------------------------------
  'brief: Since yesterday lists merges since the previous brief and resolved findings': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'a.js', '1\n'); commit(r, 'init');
    write(r, '.nightwatch/briefs/2026-07-09.md', '# old brief\n'); // the "yesterday" boundary
    git(r, ['commit', '--allow-empty', '-m', 'Merge pull request #7 from tim-nish/story/x-feature']);
    const store = openTracker(r, { tracking: { backend: 'markdown' } });
    store.recordResolution({ id: 'RC-old', date: '2026-07-10', evidence: 'the cited drift is gone' });
    collect(r, '2026-07-10');
    const since = readFile(r, '.nightwatch/MORNING.md').split('## Since yesterday')[1].split('## The road')[0];
    assert.match(since, /Merged story\/x-feature \(PR #7\)/, 'merge listed title-first (W2)');
    assert.match(since, /Resolved RC-old: the cited drift is gone/, 'resolved finding listed');
  },

  'brief: a no-change night renders exactly "Nothing new since the last brief."': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'a.js', '1\n'); commit(r, 'init');
    write(r, '.nightwatch/briefs/2026-07-09.md', '# old\n');
    collect(r, '2026-07-10'); // no merges since, no resolutions
    const since = readFile(r, '.nightwatch/MORNING.md').split('## Since yesterday')[1].split('## The road')[0];
    assert.match(since, /- Nothing new since the last brief\./);
  },

  // ---- ## The road to release (spec P3) -----------------------------------------------------
  'brief: the road renders the declared journey — goal, marks, you-are-here, gate, 🏁, blocking line': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'a.js', '1\n'); commit(r, 'state');
    write(r, '.nightwatch/STATE.md', STATE_WITH_MILESTONES);
    collect(r, '2026-07-10');
    const road = readFile(r, '.nightwatch/MORNING.md').split('## The road to release')[1].split('## ▶ First action')[0];
    assert.match(road, /\*\*Your goal — STATE\.md:\*\* First release/, 'goal verbatim + attributed');
    assert.match(road, /▶ \*\*Docs complete\*\* — \*you are here\*/, 'current milestone tagged you-are-here');
    assert.match(road, /○ \*\*Tests green\*\*/, 'later milestone visible with ○ (W3)');
    assert.match(road, /waivable gate/, 'waivable hygiene gate labelled');
    assert.match(road, /🏁 Tag the release\./, '🏁 line');
    assert.match(road, /\*\*Blocking the release:\*\* nothing/, 'blocking line');
  },

  // ---- fallback matrix (spec P3) ------------------------------------------------------------
  'brief: the road degrades — no tracker → hint; tracker but no milestones → ratio + nudge': () => {
    // No RELEASE.md / no milestones declared: the hint line.
    const r1 = tmpRepo();
    gitInit(r1); write(r1, 'a.js', '1\n'); commit(r1, 'init');
    collect(r1, '2026-07-10');
    const road1 = readFile(r1, '.nightwatch/MORNING.md').split('## The road to release')[1].split('## ▶ First action')[0];
    assert.match(road1, /No RELEASE\.md yet — run `\/release-progress`/, 'no tracker → hint line');

    // Tracker with a progress header but no milestones: the flat ratio + a declare-milestones nudge.
    const r2 = tmpRepo();
    gitInit(r2); write(r2, 'a.js', '1\n');
    write(r2, '.nightwatch/RELEASE.md', '---\nphase: hardening\ntarget: "v1"\nprogress: 0.5\nupdated: 2026-07-09\n---\n# Release progress\n');
    commit(r2, 'release no milestones');
    collect(r2, '2026-07-10');
    const road2 = readFile(r2, '.nightwatch/MORNING.md').split('## The road to release')[1].split('## ▶ First action')[0];
    assert.match(road2, /50%.*toward v1/, 'flat ratio rendered');
    assert.match(road2, /Declare `milestones:` in STATE\.md for a release roadmap\./, 'declare-milestones nudge');
  },

  // ---- byte-determinism (spec NFR8) ---------------------------------------------------------
  'brief: identical inputs render byte-identical briefs, including the new sections': () => {
    const mk = () => {
      const r = tmpRepo();
      gitInit(r); write(r, 'a.js', '1\n'); commit(r, 'init');
      write(r, '.nightwatch/STATE.md', STATE_WITH_MILESTONES);
      write(r, '.nightwatch/briefs/2026-07-09.md', '# old\n');
      collect(r, '2026-07-10');
      return readFile(r, '.nightwatch/MORNING.md');
    };
    assert.strictEqual(mk(), mk(), 'brief byte-identical across identical repos');
  },
};
