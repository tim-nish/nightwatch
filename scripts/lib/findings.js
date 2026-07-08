'use strict';
// Findings schema + stable ids + ledger. This is the inter-command interface (spec §2.5):
// every job writes .nightwatch/out/<job>-<date>.json to one schema; release-progress and
// the brief collector consume it. Ids are stable across runs (content-hash of locus+kind)
// so ledger dedupe, recurrence counting, and acted-on/dismissed tracking work.
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { outDir, nwDir, ensureDir, readJSONSafe, writeJSON, readFileSafe } = require('./util');

const JOB_PREFIX = {
  'repo-reconcile': 'RC',
  'arch-review': 'AR',
  'release-progress': 'RP',
  'nightwatch': 'NW',
};

const KINDS = ['drift', 'arch', 'blocker', 'decision', 'setup', 'info'];
const ACTIONS = ['patch-available', 'human-decision', 'daytime-task', 'none'];

/**
 * Stable id: PREFIX-<6 hex of sha1(locus|kind)>. `locus` is a caller-supplied string
 * uniquely naming *what* the finding is about (e.g. "README.md:41::drift-flag:--tag"),
 * independent of run date and of prose wording so ids survive re-runs and retitling.
 */
function makeId(job, kind, locus) {
  const prefix = JOB_PREFIX[job] || 'NW';
  const h = crypto.createHash('sha1').update(String(kind) + '|' + String(locus)).digest('hex').slice(0, 6);
  return `${prefix}-${h}`;
}

/** Build a validated finding object. Throws on schema violation (fail loud in scripts). */
function makeFinding(job, { kind, severity, title, evidence, action, verified, locus, extra }) {
  if (!KINDS.includes(kind)) throw new Error(`bad kind: ${kind}`);
  if (!(severity >= 1 && severity <= 5)) throw new Error(`bad severity: ${severity}`);
  if (!title || typeof title !== 'string') throw new Error('title required');
  const act = action || 'none';
  if (!ACTIONS.includes(act)) throw new Error(`bad action: ${act}`);
  const ev = Array.isArray(evidence) ? evidence : [];
  return Object.assign({
    id: makeId(job, kind, locus != null ? locus : title),
    kind,
    severity,
    title,
    evidence: ev,
    action: act,
    verified: verified === true,
  }, extra || {});
}

function findingsPath(root, job, date) { return path.join(outDir(root), `${job}-${date}.json`); }

function writeFindings(root, job, date, degraded, findings) {
  const doc = { job, date, degraded: degraded || [], findings: findings || [] };
  writeJSON(findingsPath(root, job, date), doc);
  return doc;
}

function readFindings(root, job, date) { return readJSONSafe(findingsPath(root, job, date)); }

/** Read all job findings docs present for a date. Missing jobs simply absent. */
function readAllFindings(root, date, jobs) {
  const out = [];
  for (const job of jobs) { const d = readFindings(root, job, date); if (d) out.push(d); }
  return out;
}

// ---- Ledger (append-only jsonl; every finding ever, with recurrence + acted marks) ----

function ledgerPath(root) { return path.join(nwDir(root), 'ledger.jsonl'); }

function readLedger(root) {
  const text = readFileSafe(ledgerPath(root));
  if (!text) return [];
  const rows = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch { /* skip corrupt line */ }
  }
  return rows;
}

function appendLedger(root, rows) {
  if (!rows || !rows.length) return;
  ensureDir(nwDir(root));
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(ledgerPath(root), text);
}

/**
 * Count prior appearances per finding id in the ledger (recurrence). Returns Map id->count.
 */
function recurrenceCounts(root) {
  const counts = new Map();
  for (const r of readLedger(root)) {
    if (r.type !== 'finding' || !r.id) continue;
    counts.set(r.id, (counts.get(r.id) || 0) + 1);
  }
  return counts;
}

module.exports = {
  JOB_PREFIX, KINDS, ACTIONS, makeId, makeFinding,
  findingsPath, writeFindings, readFindings, readAllFindings,
  ledgerPath, readLedger, appendLedger, recurrenceCounts,
};
