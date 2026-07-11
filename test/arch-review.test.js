'use strict';
// Tests for the DETERMINISTIC scaffolding of /arch-review (story 5.5). The adversarial refute
// pass and the both-sides *reasoning* are agent judgment (commands/arch-review.md) and are not
// exercised here — only the mechanical assembly, corroboration rule, phase ranking, caps, stable
// ids, and the zero-writes-outside-.nightwatch invariant.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write, gitInit, commit, readJSON } = require('./helpers');
const { archReview } = require('../scripts/arch-review');

/** Find a candidate finding by its locus. */
function byLocus(res, locus) { return res.findings.find((f) => f.locus === locus); }

/** Snapshot every file OUTSIDE .nightwatch/.git as path -> content. */
function snapshotOutside(root) {
  const out = {};
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (rel === '' && (name === '.nightwatch' || name === '.git')) continue;
      const abs = path.join(dir, name);
      const r = rel ? rel + '/' + name : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs, r);
      else out[r] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(root, '');
  return out;
}

module.exports = {
  'corroboration: exact stands alone; lone heuristic needs corroboration; two independent heuristics ground it': () => {
    const r = tmpRepo();
    // (1) EXACT: a declared layering violation (core may depend on nothing, imports api).
    write(r, '.nightwatch/config.yaml',
      'layers:\n  - {name: core, path: "core/**", may_depend_on: []}\n  - {name: api, path: "api/**", may_depend_on: [core]}\n');
    write(r, 'core/v.js', "const b = require('../api/b');");
    write(r, 'api/b.js', 'module.exports = {};');
    // (2) LONE HEURISTIC: a one-implementer-less interface — only arch:speculation, no corroboration.
    write(r, 'core/iface.ts', 'export interface Lonely {}');
    // (3) TWO INDEPENDENT HEURISTICS about the same module pair: a duplicated function name
    //     (arch:duplication) AND heavy import overlap (arch:import-overlap) between core & api.
    write(r, 'core/x.js', "const e = require('express');\nconst l = require('lodash');\nconst a = require('axios');\nfunction processData() {}\n");
    write(r, 'api/y.js', "const e = require('express');\nconst l = require('lodash');\nconst a = require('axios');\nfunction processData() {}\n");

    const res = archReview(r, { date: '2000-01-01' });

    const layer = byLocus(res, 'layer:core->api');
    assert.ok(layer, 'layering candidate exists');
    assert.strictEqual(layer.corroboration.grounded, true, 'exact signal grounds on its own');
    assert.strictEqual(layer.corroboration.needs_corroboration, false);

    const iface = byLocus(res, 'path:core/iface.ts');
    assert.ok(iface, 'speculation candidate exists');
    assert.strictEqual(iface.candidate_kind, 'speculation');
    assert.strictEqual(iface.corroboration.needs_corroboration, true, 'lone heuristic needs corroboration');
    assert.strictEqual(iface.corroboration.grounded, false);

    const pair = byLocus(res, 'pair:api|core');
    assert.ok(pair, 'module-pair candidate exists');
    assert.strictEqual(pair.corroboration.grounded, true, 'two independent heuristics ground the candidate');
    assert.strictEqual(pair.corroboration.needs_corroboration, false);
    assert.ok(pair.corroboration.sources.includes('arch:duplication') && pair.corroboration.sources.includes('arch:import-overlap'),
      'corroboration comes from two distinct sources');
    // Every candidate carries a blast radius and a both-sides argument scaffold.
    for (const f of [layer, iface, pair]) {
      assert.ok(f.blast_radius && typeof f.blast_radius.files === 'number' && typeof f.blast_radius.tests === 'number' && typeof f.blast_radius.public_surface === 'number', 'blast radius present');
      assert.ok(f.argument && typeof f.argument.for === 'string' && typeof f.argument.against === 'string', 'both-sides argument scaffold present');
      assert.strictEqual(f.verified, false, 'verified defaults false — only the adversarial agent pass flips it');
    }
  },

  'phase ranking: prototype lifts overengineering, released lifts coupling, none is neutral': () => {
    // Same repo shape three ways: a layering violation (coupling class, exact) + a lonely
    // interface (overengineering class). Only the declared phase differs.
    const build = (phaseYaml) => {
      const r = tmpRepo();
      write(r, '.nightwatch/config.yaml',
        'layers:\n  - {name: core, path: "core/**", may_depend_on: []}\n  - {name: api, path: "api/**", may_depend_on: [core]}\n');
      write(r, 'core/v.js', "const b = require('../api/b');");
      write(r, 'api/b.js', 'module.exports = {};');
      write(r, 'core/iface.ts', 'export interface Lonely {}');
      if (phaseYaml) write(r, 'STATE.md', '```yaml\n' + phaseYaml + '\n```\n');
      return archReview(r, { date: '2000-01-01' });
    };
    const idxOf = (res, kind) => res.ranked.findIndex((c) => c.candidate_kind === kind);

    const proto = build('phase: prototype');
    assert.ok(idxOf(proto, 'speculation') < idxOf(proto, 'layering-violation'),
      'prototype ranks the overengineering candidate above the coupling one');

    const released = build('phase: released');
    assert.ok(idxOf(released, 'layering-violation') < idxOf(released, 'speculation'),
      'released ranks the coupling candidate above the overengineering one');

    const none = build(null);
    // Neutral: raw signal strength decides — the exact layering signal outranks the lone heuristic.
    assert.ok(idxOf(none, 'layering-violation') < idxOf(none, 'speculation'),
      'no phase ranks neutrally by signal strength');
    // The prototype order is genuinely different from both released and neutral.
    assert.notStrictEqual(idxOf(proto, 'speculation') < idxOf(proto, 'layering-violation'),
      idxOf(released, 'speculation') < idxOf(released, 'layering-violation'));
  },

  'caps + appendix: overflow beyond caps.arch_candidates is listed by id': () => {
    const r = tmpRepo();
    // Ten distinct one-implementer-less interfaces → ten speculation candidates (default cap 7).
    for (let i = 0; i < 10; i++) write(r, `mod/iface${i}.ts`, `export interface Spec${i} {}`);
    const res = archReview(r, { date: '2000-01-01' });
    assert.strictEqual(res.ranked.length, 10, 'ten candidates assembled');
    assert.strictEqual(res.cap, 7, 'default arch_candidates cap');
    assert.strictEqual(res.brief.length, 7, 'brief capped at 7');
    assert.strictEqual(res.appendix.length, 3, 'overflow of 3 goes to the appendix');
    // Appendix entries are ids, disjoint from the brief, and are the tail of the ranked order.
    for (const id of res.appendix) assert.ok(/^AR-[0-9a-f]{6}$/.test(id), 'appendix entry is a finding id');
    assert.ok(res.appendix.every((id) => !res.brief.includes(id)), 'brief and appendix are disjoint');
    const rankedIds = res.ranked.map((c) => c.id);
    assert.deepStrictEqual(res.brief, rankedIds.slice(0, 7));
    assert.deepStrictEqual(res.appendix, rankedIds.slice(7));

    // A lower cap set in config moves more candidates to the appendix.
    const r2 = tmpRepo();
    write(r2, '.nightwatch/config.yaml', 'caps:\n  arch_candidates: 4\n');
    for (let i = 0; i < 10; i++) write(r2, `mod/iface${i}.ts`, `export interface Spec${i} {}`);
    const res2 = archReview(r2, { date: '2000-01-01' });
    assert.strictEqual(res2.cap, 4);
    assert.strictEqual(res2.brief.length, 4);
    assert.strictEqual(res2.appendix.length, 6);
  },

  'determinism: two runs on an unchanged repo yield identical finding ids (NFR8)': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, '.nightwatch/config.yaml',
      'layers:\n  - {name: core, path: "core/**", may_depend_on: []}\n  - {name: api, path: "api/**", may_depend_on: [core]}\n');
    write(r, 'core/v.js', "const b = require('../api/b');");
    write(r, 'api/b.js', 'module.exports = {};');
    write(r, 'core/iface.ts', 'export interface Lonely {}');
    commit(r, 'seed');

    const a = archReview(r, { date: '2000-01-01' });
    const b = archReview(r, { date: '2000-01-01' });
    const ids = (res) => res.findings.map((f) => f.id).sort();
    assert.deepStrictEqual(ids(a), ids(b), 'finding ids are identical across runs');
    // The persisted document agrees with the in-memory result.
    const doc = readJSON(r, '.nightwatch/runtime/out/arch-review-2000-01-01.json');
    assert.deepStrictEqual(doc.findings.map((f) => f.id).sort(), ids(a));
  },

  'zero writes outside .nightwatch/ (NFR3)': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, 'core/x.js', "const e = require('express');\nconst l = require('lodash');\nconst a = require('axios');\nfunction processData() {}\n");
    write(r, 'api/y.js', "const e = require('express');\nconst l = require('lodash');\nconst a = require('axios');\nfunction processData() {}\n");
    write(r, 'core/iface.ts', 'export interface Lonely {}');
    write(r, 'README.md', '# demo\n');
    commit(r, 'seed');

    const before = snapshotOutside(r);
    archReview(r, { date: '2000-01-01' });
    const after = snapshotOutside(r);
    assert.deepStrictEqual(after, before, 'no file outside .nightwatch/ was created or modified');
    // The job DID write its output under .nightwatch/.
    assert.ok(fs.existsSync(path.join(r, '.nightwatch', 'runtime', 'out', 'arch-review-2000-01-01.json')), 'findings doc written under .nightwatch/runtime/');
    assert.ok(fs.existsSync(path.join(r, '.nightwatch', 'ledger.jsonl')), 'ledger written under .nightwatch/');
  },
};
