'use strict';
// Story 1.1 skeleton contract: manifest, install budget, dual-mode path resolution, and the
// type-check gate. These assertions are mechanical so a regression (a hardcoded path, a stray
// runtime dependency, a missing // @ts-check) fails the suite instead of shipping silently.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COMMANDS = ['nightwatch', 'repo-reconcile', 'arch-review', 'release-progress'];

/** All *.js files under scripts/ (recursive). */
function scriptFiles() {
  const out = [];
  (function rec(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) rec(abs);
      else if (e.name.endsWith('.js')) out.push(abs);
    }
  })(path.join(ROOT, 'scripts'));
  return out.sort();
}

module.exports = {
  'manifest: plugin.json declares name, version, and all four commands': () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(m.name, 'nightwatch');
    assert.ok(/^\d+\.\d+\.\d+/.test(m.version), 'version is semver-ish');
    const declared = new Set((m.commands || []).map((c) => path.basename(c, '.md')));
    for (const c of COMMANDS) assert.ok(declared.has(c), `plugin.json declares ${c}`);
    assert.strictEqual(m.commands.length, COMMANDS.length, 'exactly the four commands');
  },

  'install budget: js-yaml is the only runtime dependency, TypeScript is dev-only, no build step': () => {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(p.dependencies || {}), ['js-yaml'], 'one runtime dep: js-yaml');
    assert.ok((p.devDependencies || {}).typescript, 'typescript is a devDependency');
    for (const hook of ['postinstall', 'preinstall', 'install', 'prepare', 'build']) {
      assert.ok(!(p.scripts || {})[hook], `no ${hook} script (clone → install → run)`);
    }
    assert.ok(/\btsc\b/.test((p.scripts || {}).test || ''), 'npm test runs tsc');
  },

  'type-check gate: every scripts/**/*.js carries // @ts-check and shared typedefs are centralized': () => {
    for (const f of scriptFiles()) {
      const head = fs.readFileSync(f, 'utf8').split('\n', 4).join('\n');
      assert.ok(/^\/\/ @ts-check$/m.test(head), `${path.relative(ROOT, f)} starts with // @ts-check`);
    }
    const types = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'types.js'), 'utf8');
    for (const t of ['Finding', 'FindingsDoc', 'Config', 'LoadedConfig', 'Args']) {
      assert.ok(new RegExp(`@typedef[^\\n]*\\b${t}\\b|} ${t}\\b`).test(types), `types.js defines ${t}`);
    }
  },

  'dual-mode resolution: the root chain is byte-identical across all four commands': () => {
    const blocks = COMMANDS.map((c) => {
      const text = fs.readFileSync(path.join(ROOT, 'commands', `${c}.md`), 'utf8');
      const m = text.match(/## Script root resolution[\s\S]*?not guess a path\./);
      assert.ok(m, `${c}.md has a Script root resolution block`);
      return m[0];
    });
    // All four blocks must be exactly equal — single helper, no per-mode conditional (FR2/FR3).
    for (const b of blocks) assert.strictEqual(b, blocks[0], 'resolution block identical across commands');
    // The chain must be CLAUDE_PLUGIN_ROOT -> NIGHTWATCH_ROOT -> refuse, in that order.
    const b = blocks[0];
    assert.ok(b.indexOf('CLAUDE_PLUGIN_ROOT') < b.indexOf('NIGHTWATCH_ROOT'), 'plugin root preferred first');
    assert.ok(/stop immediately/.test(b), 'refuses when neither is set');
  },

  'no bypass: commands invoke scripts only through ${NW_ROOT}, never a hardcoded/relative path': () => {
    for (const c of COMMANDS) {
      const text = fs.readFileSync(path.join(ROOT, 'commands', `${c}.md`), 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/scripts\/[\w./-]+\.js/);
        if (!m) continue;
        assert.ok(/\$\{NW_ROOT\}\/scripts\//.test(line), `${c}.md resolves script through NW_ROOT: ${line.trim()}`);
        assert.ok(!/\.\.\/scripts\//.test(line), `${c}.md has no relative script path: ${line.trim()}`);
      }
    }
  },
};
