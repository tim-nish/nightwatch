#!/usr/bin/env node
'use strict';
// Minimal test runner: discovers test/*.test.js, each exporting a map of {name: fn}.
// A test fn throws (assert) on failure. Prints a summary and exits non-zero on any failure.
// Deliberately dependency-free — the plugin ships js-yaml only.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();

let pass = 0, fail = 0;
const failures = [];

for (const file of files) {
  const suite = require(path.join(dir, file));
  const tests = typeof suite === 'function' ? { [file]: suite } : suite;
  for (const [name, fn] of Object.entries(tests)) {
    const label = `${file} › ${name}`;
    try {
      fn();
      pass++;
      process.stdout.write(`  ✓ ${label}\n`);
    } catch (e) {
      fail++;
      failures.push({ label, e });
      process.stdout.write(`  ✗ ${label}\n`);
    }
  }
}

process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
if (fail) {
  process.stdout.write('\nFailures:\n');
  for (const { label, e } of failures) {
    process.stdout.write(`\n✗ ${label}\n${(e && e.stack) || e}\n`);
  }
  process.exit(1);
}
