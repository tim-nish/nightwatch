// @ts-check
'use strict';
// Normalized signals schema — the single shape every architecture-review extractor emits and
// the judgment layer consumes (spec §2.6, FR8). A signal is a deterministic, evidence-backed
// *candidate* observation with a confidence; extractors never decide, they only surface.
// Mirrors findings.js so the two inter-command schemas evolve the same way.
const path = require('path');
const { outDir, writeJSON, readJSONSafe } = require('./util');

/** @typedef {import('./types').Signal} Signal */
/** @typedef {import('./types').SignalsDoc} SignalsDoc */
/** @typedef {import('./types').Confidence} Confidence */

// Signals-document major schema version. Consumers reject a document whose major is higher
// than this rather than misreading a shape they don't understand (FR6/FR8). Bump only on a
// breaking change to the Signal/SignalsDoc shape.
const SCHEMA_VERSION = 1;

// Confidence in a signal. `exact` = a mechanical fact (a file exists; N commits touched it);
// `heuristic` = an inference that may be wrong (co-change *implies* coupling). The judgment
// layer weights these differently.
const CONFIDENCE = ['exact', 'heuristic'];

// Known signal kinds. Extractors may emit only these so the judgment layer reasons over a
// closed set; new kinds are added here deliberately, never ad hoc. The first group is the
// universal-git built-in's; the second is what tool adapters (§2.6) contribute.
const KINDS = [
  // universal-git built-ins (story 5.1)
  'hotspot', 'hidden-coupling', 'growth-trend', 'file-tree', 'readme', 'todo-density',
  // tool-adapter kinds (§2.6): things a real analyzer proves or a judgment layer names
  'layering-violation', 'cycle', 'orphan', 'unused-export', 'duplication', 'speculation',
];

/**
 * Normalize one evidence entry to a structured `{path, line?}` object (identical contract to
 * findings.js): callers may pass a bare `"path"` or `"path:line"` string for convenience.
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
 * Build a validated signal object. Throws on schema violation (fail loud in scripts).
 * @param {{ kind: string, confidence: string, detail: string, source: string, evidence?: any[], extra?: object }} spec
 * @returns {Signal}
 */
function makeSignal({ kind, confidence, evidence, detail, source, extra }) {
  if (!KINDS.includes(kind)) throw new Error(`bad signal kind: ${kind}`);
  if (!CONFIDENCE.includes(confidence)) throw new Error(`bad confidence: ${confidence}`);
  if (!detail || typeof detail !== 'string') throw new Error('signal detail required');
  if (!source || typeof source !== 'string') throw new Error('signal source required');
  const ev = (Array.isArray(evidence) ? evidence : []).map(normalizeEvidence).filter(Boolean);
  return Object.assign({ kind, confidence, evidence: ev, detail, source }, extra || {});
}

function signalsPath(root, date) { return path.join(outDir(root), `signals-${date}.json`); }

/**
 * Assemble a validated signals document. `sources` names the extractors that ran, `degraded`
 * carries skip/setup notes, `signals` are the validated observations.
 * @param {string} date
 * @param {{ sources?: any[], degraded?: string[], signals?: Signal[] }} [parts]
 * @returns {SignalsDoc}
 */
function makeSignalsDoc(date, { sources, degraded, signals } = {}) {
  return {
    schema: SCHEMA_VERSION,
    job: 'signals',
    date,
    sources: sources || [],
    degraded: degraded || [],
    signals: signals || [],
  };
}

function writeSignals(root, date, parts) {
  const doc = makeSignalsDoc(date, parts);
  writeJSON(signalsPath(root, date), doc);
  return doc;
}

/** Reject a document whose major schema is newer than we understand (FR6/FR8). */
function assertReadableSchema(doc) {
  const v = typeof doc.schema === 'number' ? Math.floor(doc.schema) : 1;
  if (v > SCHEMA_VERSION) {
    throw new Error(`signals schema v${v} is newer than supported v${SCHEMA_VERSION}; refusing to read`);
  }
  return doc;
}

/**
 * @returns {SignalsDoc | null}
 * @throws if the file's major schema version exceeds this build's (FR6/FR8).
 */
function readSignals(root, date) {
  const doc = readJSONSafe(signalsPath(root, date));
  return doc == null ? null : assertReadableSchema(doc);
}

module.exports = {
  SCHEMA_VERSION, CONFIDENCE, KINDS, normalizeEvidence, makeSignal,
  makeSignalsDoc, writeSignals, readSignals, signalsPath, assertReadableSchema,
};
