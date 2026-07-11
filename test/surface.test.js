'use strict';
const assert = require('assert');
const { tmpRepo, write } = require('./helpers');
const { inventory, detectEcosystem } = require('../scripts/surface-inventory');

module.exports = {
  'surface: node extractor finds exports, flags, subcommands, bins, env keys': () => {
    const r = tmpRepo();
    write(r, 'package.json', JSON.stringify({ name: 'demo', bin: { demo: 'cli.js' }, scripts: { build: 'x' } }));
    write(r, 'cli.js', [
      "export function runIt() {}",
      "export const helper = 1;",
      "program.command('serve');",
      "if (args['--tag']) {}",
      "const k = process.env.API_TOKEN;",
    ].join('\n'));
    const inv = inventory(r);
    assert.strictEqual(inv.ecosystem, 'node');
    assert.ok(inv.exports.some((e) => e.name === 'runIt'));
    assert.ok(inv.exports.some((e) => e.name === 'helper'));
    assert.ok(inv.cli.flags.includes('--tag'));
    assert.ok(inv.cli.subcommands.includes('serve'));
    assert.ok(inv.bins.includes('demo'));
    assert.ok(inv.config_keys.includes('API_TOKEN'));
    assert.deepStrictEqual(inv.degraded, []);
  },

  'surface: unknown ecosystem → universal fallback only, degraded stated': () => {
    const r = tmpRepo();
    write(r, 'main.go', 'package main');
    write(r, 'commands/foo.md', '# foo');
    write(r, 'README.md', 'Run with `--verbose`.\n\n```sh\ndemo --verbose\n```\n');
    const inv = inventory(r);
    assert.strictEqual(detectEcosystem(r), 'unknown');
    assert.ok(inv.degraded.some((d) => /no extractor/.test(d)));
    // Universal signals still present.
    assert.ok(inv.command_files.includes('commands/foo.md'));
    assert.ok(inv.readme_flag_tokens.includes('--verbose'));
    assert.ok(inv.readme_code_blocks.length >= 1);
    assert.ok(inv.file_tree.total_files >= 3);
  },

  'surface: python extractor finds argparse flags and subparsers': () => {
    const r = tmpRepo();
    write(r, 'pyproject.toml', '[project]\nname="demo"\n');
    write(r, 'app.py', [
      'def public_fn():',
      '    pass',
      'def _private():',
      '    pass',
      "parser.add_argument('--count')",
      "sub.add_parser('sync')",
      "os.environ['DB_URL']",
    ].join('\n'));
    const inv = inventory(r);
    assert.strictEqual(inv.ecosystem, 'python');
    assert.ok(inv.exports.some((e) => e.name === 'public_fn'));
    assert.ok(!inv.exports.some((e) => e.name === '_private'), 'private names excluded');
    assert.ok(inv.cli.flags.includes('--count'));
    assert.ok(inv.cli.subcommands.includes('sync'));
    assert.ok(inv.config_keys.includes('DB_URL'));
  },

  'surface: broken package.json captured as blocking failure, universal surface still valid (FR36)': () => {
    const r = tmpRepo();
    write(r, 'package.json', '{ "name": "demo", broken json here ');
    write(r, 'cli.js', 'export function go() {}');
    write(r, 'README.md', '# demo\n');
    const inv = inventory(r);
    assert.strictEqual(inv.ecosystem, 'node');
    assert.ok(inv.blocking.length >= 1, 'blocking failure captured for consumer to rank #1');
    assert.ok(inv.blocking.some((b) => /package\.json/.test(b.reason)));
    assert.ok(inv.blocking[0].evidence.some((e) => e.path === 'package.json'));
    // The document is still valid: universal signals are present even when blocked.
    assert.ok(inv.file_tree.total_files >= 1);
    assert.strictEqual(inv.readme_path, 'README.md');
  },

  'surface: healthy repo reports no blocking failures': () => {
    const r = tmpRepo();
    write(r, 'package.json', JSON.stringify({ name: 'ok' }));
    write(r, 'a.js', 'export const x = 1;');
    const inv = inventory(r);
    assert.deepStrictEqual(inv.blocking, []);
  },

  // Story 12.5 / FR103 — a scope-emptied signal source states its consequence; it never reads clean.
  'surface: command files excluded BY SCOPE → a degraded line names the glob + consequence (FR103)': () => {
    const r = tmpRepo();
    // Top-level commands/ has no shipped `!re-include` (unlike .claude/commands/**), so a user
    // exclusion genuinely empties the signal — the 0028 shape: command files present but scope-excluded.
    write(r, 'commands/ask.md', '# /ask');
    write(r, 'commands/triage.md', '# /triage');
    write(r, '.nightwatch/config.yaml', 'dev_tooling: ["commands/**"]\n');
    const inv = inventory(r);
    assert.strictEqual(inv.command_files.length, 0, 'scope emptied the command-file signal');
    const line = inv.degraded.find((d) => /command file\(s\) are not in the surface inventory/.test(d));
    assert.ok(line, 'a degraded line is present');
    assert.match(line, /scope excludes .*commands\/\*\*/, 'names the excluding glob');
    assert.match(line, /command claims are NOT deterministically checked/, 'names the consequence');
  },

  'surface: removing the exclusion drops the degraded line — the pairing is enforced (FR103)': () => {
    const r = tmpRepo();
    write(r, '.claude/commands/ask.md', '# /ask');
    // No exclusion of the command dir (shipped defaults re-include .claude/commands): analyzed, no line.
    const inv = inventory(r);
    assert.ok(inv.command_files.length >= 1, 'command files analyzed when not scope-excluded');
    assert.ok(!inv.degraded.some((d) => /command file\(s\) are not in the surface inventory/.test(d)), 'no degraded line when the source is populated');
  },
};
