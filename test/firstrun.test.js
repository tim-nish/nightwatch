'use strict';
// Story 7.6 — first-run confirmation screen: labels, change preview, classified strays (FR45–FR47).
// The screen's labels and gate are agent-driven (commands/nightwatch.md); the deterministic core
// pinned here is the stray classification (a name heuristic, never a content judgment) and the
// exact config.yaml ignore-block preview shown before any write.
const assert = require('assert');
const { tmpRepo, write, gitInit, commit, git, runScript } = require('./helpers');
const { classifyUntracked, renderIgnorePreview, isTempName } = require('../scripts/lib/firstrun');

module.exports = {
  // ---- P7.4: two independently-acceptable groups --------------------------------------------
  'firstrun: classifies untracked files into temp/crash artifacts vs ordinary documents': () => {
    const groups = classifyUntracked([
      'answer.md', 'bash.exe.stackdump', 'question.md', 'core.1234', 'notes.txt', 'server.log', 'a.tmp',
    ]);
    assert.deepStrictEqual(groups.temp, ['a.tmp', 'bash.exe.stackdump', 'core.1234', 'server.log'], 'crash/temp artifacts grouped + sorted');
    assert.deepStrictEqual(groups.documents, ['answer.md', 'notes.txt', 'question.md'], 'ordinary documents grouped + sorted');
  },

  'firstrun: the heuristic is name-based only — content is never read': () => {
    // A .md whose CONTENT looks like a crash dump is still a document; a .stackdump is still temp.
    assert.strictEqual(isTempName('CRASH-LOG.md'), false, 'extension .md → document regardless of name suffix');
    assert.strictEqual(isTempName('editor.swp'), true);
    assert.strictEqual(isTempName('nested/dir/core.99'), true, 'matched on basename within a path');
    assert.strictEqual(isTempName('~backup'), false, 'only a TRAILING ~ is a temp marker');
    assert.strictEqual(isTempName('draft~'), true);
  },

  'firstrun: the two groups are independently acceptable (empty groups are fine)': () => {
    assert.deepStrictEqual(classifyUntracked(['only.stackdump']), { temp: ['only.stackdump'], documents: [] });
    assert.deepStrictEqual(classifyUntracked(['only.md']), { temp: [], documents: ['only.md'] });
    assert.deepStrictEqual(classifyUntracked([]), { temp: [], documents: [] });
  },

  // ---- P7.2: preview the exact config change before writing ---------------------------------
  'firstrun: renderIgnorePreview shows the exact ignore block, sorted and deduped': () => {
    const preview = renderIgnorePreview(['question.md', 'answer.md', 'answer.md', 'bash.exe.stackdump']);
    assert.strictEqual(preview,
      '# will be added to .nightwatch/config.yaml\nignore:\n  - answer.md\n  - bash.exe.stackdump\n  - question.md\n');
  },

  'firstrun: an empty selection previews nothing (nothing to write)': () => {
    assert.strictEqual(renderIgnorePreview([]), null);
    assert.strictEqual(renderIgnorePreview(['', '   ']), null);
  },

  // ---- CLI: read-only surface for the screen ------------------------------------------------
  'firstrun: the CLI groups real untracked files and previews the ignore block, writing nothing': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'src/app.js', 'module.exports = 1;\n');
    commit(root, 'tracked');
    // Untracked strays present at first run.
    write(root, 'bash.exe.stackdump', 'x');
    write(root, 'question.md', '# q');
    const before = git(root, ['status', '--porcelain']);

    const { stdout } = runScript('first-run.js', root);
    const res = JSON.parse(stdout);
    assert.strictEqual(res.status, 'ok');
    assert.ok(res.groups.temp.includes('bash.exe.stackdump'));
    assert.ok(res.groups.documents.includes('question.md'));
    assert.ok(res.ignore_preview.temp.includes('- bash.exe.stackdump'), 'temp-only preview');
    assert.ok(res.ignore_preview.all.includes('- question.md'), 'all preview includes documents');

    // Read-only: the working tree is byte-identical (nothing written, no config edit).
    assert.strictEqual(git(root, ['status', '--porcelain']), before, 'first-run.js wrote nothing');
  },
};
