// @ts-check
'use strict';
// Findings schema + stable ids + ledger. This is the inter-command interface (spec §2.5):
// every job writes .nightwatch/out/<job>-<date>.json to one schema; release-progress and
// the brief collector consume it. Ids are stable across runs (content-hash of locus+kind)
// so ledger dedupe, recurrence counting, and acted-on/dismissed tracking work.
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { outDir, legacyOutDir, nwDir, ensureDir, readJSONSafe, writeJSON, readFileSafe } = require('./util');

/** @typedef {import('./types').Job} Job */
/** @typedef {import('./types').Finding} Finding */
/** @typedef {import('./types').FindingsDoc} FindingsDoc */
/** @typedef {import('./types').LedgerRow} LedgerRow */

const JOB_PREFIX = {
  'repo-reconcile': 'RC',
  'arch-review': 'AR',
  'release-progress': 'RP',
  'nightwatch': 'NW',
};

const KINDS = ['drift', 'arch', 'blocker', 'decision', 'setup', 'info'];
const ACTIONS = ['patch-available', 'human-decision', 'daytime-task', 'none'];

// Findings-document major schema version. Consumers reject a document whose major is
// higher than this rather than misreading a shape they don't understand (FR6). Bump only
// on a breaking change to the Finding/FindingsDoc shape.
const SCHEMA_VERSION = 1;

/**
 * Normalize a single evidence entry to a structured `{path, line}` object. Callers may pass
 * a bare `"path"` or `"path:line"` string for convenience; findings always store objects so
 * downstream consumers read `.path`/`.line` uniformly (FR6).
 */
function normalizeEvidence(e) {
  if (e == null) return null;
  if (typeof e === 'string') {
    const m = e.match(/^(.*):(\d+)$/);
    return m ? { path: m[1], line: Number(m[2]) } : { path: e };
  }
  if (typeof e === 'object' && typeof e.path === 'string') {
    const out = { path: e.path };
    if (e.line != null) out.line = e.line;
    return out;
  }
  throw new Error('evidence entries must be {path, line?} objects or "path[:line]" strings');
}

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
  const ev = (Array.isArray(evidence) ? evidence : []).map(normalizeEvidence).filter(Boolean);
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
  const doc = { schema: SCHEMA_VERSION, job, date, degraded: degraded || [], findings: findings || [] };
  writeJSON(findingsPath(root, job, date), doc);
  return doc;
}

/**
 * Reject a document whose major schema is newer than we understand (FR6). A missing `schema`
 * is treated as v1 (pre-versioning docs); a lower version is still readable.
 * @param {any} doc @returns {FindingsDoc}
 */
function assertReadableSchema(doc) {
  const v = typeof doc.schema === 'number' ? Math.floor(doc.schema) : 1;
  if (v > SCHEMA_VERSION) {
    throw new Error(`findings schema v${v} is newer than supported v${SCHEMA_VERSION}; refusing to read`);
  }
  return doc;
}

/**
 * @returns {FindingsDoc | null}
 * @throws if the file's major schema version exceeds this build's (FR6).
 */
function readFindings(root, job, date) {
  // Read from the runtime path, falling back to the legacy `.nightwatch/out/` location (spec
  // runtime-layout P2) so a legacy install's per-run docs still resolve until a confirmed migration.
  let doc = readJSONSafe(findingsPath(root, job, date));
  if (doc == null) doc = readJSONSafe(path.join(legacyOutDir(root), `${job}-${date}.json`));
  return doc == null ? null : assertReadableSchema(doc);
}

/** Read all job findings docs present for a date. Missing jobs simply absent. */
function readAllFindings(root, date, jobs) {
  const out = [];
  for (const job of jobs) { const d = readFindings(root, job, date); if (d) out.push(d); }
  return out;
}

/**
 * Collapse findings sharing an id to one survivor, keeping recurrence countable by id (FR7).
 * First occurrence of each id wins (stable order); `counts` maps id → number of occurrences.
 * @param {Finding[]} findings
 * @returns {{ findings: Finding[], counts: Map<string, number> }}
 */
function dedupeFindings(findings) {
  const survivors = new Map();
  const counts = new Map();
  for (const f of findings || []) {
    counts.set(f.id, (counts.get(f.id) || 0) + 1);
    if (!survivors.has(f.id)) survivors.set(f.id, f);
  }
  return { findings: [...survivors.values()], counts };
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
  JOB_PREFIX, KINDS, ACTIONS, SCHEMA_VERSION, makeId, makeFinding, normalizeEvidence, dedupeFindings,
  findingsPath, writeFindings, readFindings, readAllFindings, assertReadableSchema,
  ledgerPath, readLedger, appendLedger, recurrenceCounts,
};
