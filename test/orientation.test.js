'use strict';
// Story 9.7 — orientation README v2, the four-column map (spec runtime-layout P5, FR90). Grep-guards
// (as in 8.5) over the shipped template, the plugin README, and docs/install.md: each renders the
// four-column map (edit? / owner / safe to delete? / committed?), states the runtime/-is-disposable
// subtlety and the ledger-is-memory subtlety, and `init` still writes the template write-if-absent.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT, tmpRepo, readFile } = require('./helpers');
const { writeReadme } = require('../scripts/lib/init');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DOCS = {
  'templates/nightwatch-readme.md': read('templates/nightwatch-readme.md'),
  'README.md': read('README.md'),
  'docs/install.md': read('docs/install.md'),
};

const COLUMN_HEADER = '| edit? | owner | safe to delete? | committed? |';

module.exports = {
  'orientation: every layout doc renders the four-column header': () => {
    for (const [name, text] of Object.entries(DOCS)) {
      assert.ok(text.includes(COLUMN_HEADER), `${name} is missing the four-column header`);
    }
  },

  'orientation: every layout doc states the runtime/-is-disposable subtlety': () => {
    for (const [name, text] of Object.entries(DOCS)) {
      assert.match(text, /`runtime\/` is disposable/, `${name} is missing the runtime/-is-disposable sentence`);
    }
  },

  'orientation: every layout doc states the ledger-is-memory subtlety': () => {
    for (const [name, text] of Object.entries(DOCS)) {
      assert.match(text, /`ledger\.jsonl` is Nightwatch's memory/, `${name} is missing the ledger-is-memory sentence`);
    }
  },

  'orientation: the template carries the STATE.md / cursors.json disarming line (new name)': () => {
    const t = DOCS['templates/nightwatch-readme.md'];
    assert.match(t, /`STATE\.md` is yours; `runtime\/cursors\.json` is the machine's scheduling cursor/);
    // The superseded state.json name no longer appears as a live path in the template map rows.
    assert.ok(!/^\| `state\.json`/m.test(t), 'no live state.json row remains');
  },

  // FR65 write mechanics unchanged: init writes the v2 template to .nightwatch/README.md when absent,
  // and never clobbers an existing (possibly user-edited) copy.
  'orientation: init writes the four-column README write-if-absent (FR65 unchanged)': () => {
    const r = tmpRepo();
    const first = writeReadme(r);
    assert.strictEqual(first.written, true);
    assert.ok(readFile(r, '.nightwatch/README.md').includes(COLUMN_HEADER), 'the four-column map is written');
    // A second call never overwrites (write-if-absent).
    assert.strictEqual(writeReadme(r).written, false, 'existing README is left untouched');
  },
};
