// @ts-check
'use strict';
// Finding lifecycle (spec docs/specs/finding-lifecycle.md §P1): open-finding carry-forward and
// per-run classification. Pure functions over ledger rows — no I/O. The tracking store is the sole
// ledger reader/writer (§2.7); these helpers compute the open set from the rows the store hands
// them and produce the classification rows the store appends. So an unfixed finding can never
// simply not be looked at again (0019 gap 1): every run ends by classifying every open finding.
//
// Story 9.1 ships P1 (carry-forward + classification rows + exactly-once). Story 9.2 adds the
// deterministic re-verification floor (P2 — free, zero tokens) and the budgeted judgment-recheck
// arithmetic (P3), which plug into `classifyOpenFindings`'s `classifier`. Judgment itself spends
// tokens and is the owning job/subagent's work; the scripts here own the free floor and the budget
// accounting, deferring anything inconclusive to `escalate` — never a silent close.
const fs = require('fs');
const path = require('path');
const { readFileSafe, exists, outDir } = require('./util');

/** The four per-run states every open finding is classified into, exactly once (spec P1 table). */
const CLASSIFICATIONS = ['re-observed', 'resolved', 'still-open', 'not-re-examined'];
/** Recheck-row methods: `deterministic`|`judgment` re-examined it, `skipped` means budget/scope didn't reach it. */
const RECHECK_METHODS = ['deterministic', 'judgment', 'skipped'];

/**
 * Compute the open finding set from ledger rows. An OPEN finding (spec P1) is one that has at least
 * one `finding` row and neither a `resolution` row nor a `dismissed` feedback row for its id — an
 * acted-on (`[x]`) feedback row does NOT close it (only evidence-gone resolution or a `[-]` dismissal
 * does). Returned oldest-first (first-seen date, then id) — the deterministic order P3 processes and
 * P1 classifies in (NFR8).
 * @param {any[]} rows Ledger rows (from store.readLedger()).
 * @returns {Array<{id: string, kind: string, severity: number, firstDate: string, lastDate: string}>}
 */
function openFindings(rows, opts = {}) {
  // Run-relative open set (spec finding-lifecycle P7.1, FR93): a finding row written by the CURRENT
  // run is an OUTPUT of the night, never an input to its own classification. `excludeDate` drops
  // every finding row of that date so tonight's findings — including a member CLI's rows appended
  // before the collector runs — are not mistaken for carried-forward work. A genuinely
  // carried-forward finding still surfaces via its earlier-dated rows; on a repo's first run the
  // incoming open set is empty and every finding classifies as new. Keyed on the run's date so a
  // forced same-date re-run also classifies against the pre-tonight set (not its own rows).
  const excludeDate = opts.excludeDate || null;
  const closed = new Set();
  for (const r of rows || []) {
    if (!r || !r.id) continue;
    if (r.type === 'resolution') closed.add(r.id);
    else if (r.type === 'feedback' && String(r.verdict) === 'dismissed') closed.add(r.id);
  }
  const byId = new Map();
  for (const r of rows || []) {
    if (!r || r.type !== 'finding' || !r.id || closed.has(r.id)) continue;
    if (excludeDate && r.date === excludeDate) continue;
    const d = r.date || '';
    const cur = byId.get(r.id);
    if (!cur) {
      byId.set(r.id, {
        id: r.id, kind: r.kind, severity: r.severity, firstDate: d, lastDate: d,
        evidence: Array.isArray(r.evidence) ? r.evidence : [],
        text: typeof r.text === 'string' ? r.text : undefined,
      });
    } else {
      if (d && (!cur.firstDate || d < cur.firstDate)) cur.firstDate = d;
      if (d && d > cur.lastDate) cur.lastDate = d;
      if (cur.kind == null && r.kind != null) cur.kind = r.kind;
      if (cur.severity == null && r.severity != null) cur.severity = r.severity;
      // A later finding row carries the freshest cited evidence/text — the floor checks against it.
      if (Array.isArray(r.evidence) && r.evidence.length) cur.evidence = r.evidence;
      if (typeof r.text === 'string') cur.text = r.text;
    }
  }
  return [...byId.values()].sort(
    (a, b) => String(a.firstDate).localeCompare(String(b.firstDate)) || a.id.localeCompare(b.id),
  );
}

/**
 * Story-9.1 default classifier. With no re-verification floor yet (Story 9.2 adds P2/P3), an open
 * finding that tonight's run did NOT re-observe is conservatively `not-re-examined` — the spec's
 * "when in doubt" default — so the finding still surfaces rather than silently vanishing. Story 9.2
 * replaces this with the deterministic-absence floor plus a budgeted judgment recheck.
 * @returns {{ classification: string, method?: string, evidence?: string }}
 */
function defaultClassifier() {
  return { classification: 'not-re-examined', method: 'skipped' };
}

/**
 * Classify each open finding exactly once (spec P1). A finding re-observed tonight (its id is in
 * `reobserved`) is `re-observed` and gets NO extra row — its finding row already dedupes as today.
 * Every other open finding is handed to `classifier`, which returns `resolved` (with an evidence
 * clause → a `resolution` row carrying id/date/evidence), `still-open` (with a recheck `method` →
 * a `recheck` row), or `not-re-examined` (→ a `recheck` row, method `skipped`). Input order is
 * oldest-first, so the output — and thus the rows appended — is byte-deterministic (NFR8).
 * @param {{ open: any[], reobserved: Set<string>|string[], date: string, classifier?: (f:any)=>any }} args
 * @returns {Array<{id: string, classification: string, row: object|null}>}
 */
function classifyOpenFindings({ open, reobserved, date, classifier = defaultClassifier }) {
  const seen = reobserved instanceof Set ? reobserved : new Set(reobserved || []);
  const out = [];
  for (const f of open || []) {
    if (seen.has(f.id)) { out.push({ id: f.id, classification: 're-observed', row: null }); continue; }
    const v = classifier(f) || {};
    if (v.classification === 'resolved') {
      out.push({ id: f.id, classification: 'resolved', row: { type: 'resolution', id: f.id, date, evidence: String(v.evidence || '') } });
    } else if (v.classification === 'still-open') {
      const method = RECHECK_METHODS.includes(v.method) ? v.method : 'deterministic';
      out.push({ id: f.id, classification: 'still-open', row: { type: 'recheck', id: f.id, date, method } });
    } else {
      out.push({ id: f.id, classification: 'not-re-examined', row: { type: 'recheck', id: f.id, date, method: 'skipped' } });
    }
  }
  return out;
}

// ---- P2: deterministic re-verification floor (zero tokens) --------------------------------

// Kinds for which the conclusive ABSENCE of the cited evidence means the finding is resolved (spec
// P2: "a drift finding whose drifted text is gone"). For every other kind, absence is inconclusive
// and the finding is escalated to the judgment recheck rather than auto-closed (spec non-goals).
const ABSENCE_CONCLUSIVE = new Set(['drift']);
// Window (± lines) around the cited line within which the cited text still counts as "present at or
// near the cited line" (spec P2). A finding with no cited line is checked against the whole file.
const NEAR_LINES = 3;

/** First evidence locus carrying a path (findings store `{path, line?}` objects, never bare strings). */
function primaryLocus(finding) {
  const ev = (finding && finding.evidence) || [];
  for (const e of ev) if (e && typeof e.path === 'string' && e.path) return e;
  return null;
}

/** Is `needle` present in `text`, and — when `line` is given — within ±NEAR_LINES of it? */
function textPresentNear(text, needle, line) {
  const norm = String(needle).trim();
  if (!norm) return false;
  if (!Number.isFinite(line)) return text.includes(norm);
  const lines = text.split('\n');
  const lo = Math.max(0, (line - 1) - NEAR_LINES);
  const hi = Math.min(lines.length, line + NEAR_LINES);
  return lines.slice(lo, hi).join('\n').includes(norm);
}

/**
 * The deterministic re-verification floor (spec P2). A pure filesystem check over an open finding's
 * cited evidence — zero tokens — returning one of:
 *   - `resolved`     the cited path is gone, or the cited `text` is no longer present at/near the
 *                    cited line, AND the finding's kind makes absence conclusive (drift). Carries an
 *                    evidence clause naming why.
 *   - `still-open`   the cited evidence is still present (path exists; cited text, if recorded, still
 *                    at/near the line). Method `deterministic`. This is the check that would have
 *                    caught the RC-615fba disappearance.
 *   - `escalate`     unresolvable deterministically (no cited path, or absence for an inconclusive
 *                    kind) → hand to the budgeted judgment recheck (P3).
 * `read`/`fileExists` are injectable for tests; they default to the real filesystem under `root`.
 * @param {{kind?:string, evidence?:Array<{path:string,line?:number}>, text?:string}} finding
 * @param {string} root Repo root the evidence paths are relative to.
 * @param {{read?:(rel:string)=>(string|null), fileExists?:(rel:string)=>boolean}} [io]
 * @returns {{classification:'resolved'|'still-open'|'escalate', method?:string, evidence?:string}}
 */
function deterministicFloor(finding, root, io = {}) {
  const read = io.read || ((rel) => readFileSafe(path.join(root, rel.split('/').join(path.sep))));
  const fileExists = io.fileExists || ((rel) => exists(path.join(root, rel.split('/').join(path.sep))));
  const conclusive = ABSENCE_CONCLUSIVE.has(finding && finding.kind);
  const loc = primaryLocus(finding);
  if (!loc) return { classification: 'escalate' }; // no checkable locus → unresolvable

  const at = loc.line != null ? `${loc.path}:${loc.line}` : loc.path;
  if (!fileExists(loc.path)) {
    return conclusive
      ? { classification: 'resolved', evidence: `cited path ${loc.path} no longer exists` }
      : { classification: 'escalate' };
  }

  const cited = finding && typeof finding.text === 'string' ? finding.text : '';
  if (cited) {
    const text = read(loc.path);
    if (text != null && textPresentNear(text, cited, loc.line)) {
      return { classification: 'still-open', method: 'deterministic' };
    }
    // Cited text gone from the file → resolved iff absence is conclusive for the kind, else escalate.
    return conclusive
      ? { classification: 'resolved', evidence: `cited text no longer present at ${at}` }
      : { classification: 'escalate' };
  }

  // Path present but no recorded cited text to check: the cited artifact still exists, so hold it
  // still-open (deterministic) rather than close it — "when in doubt, still-open" (spec non-goals).
  return { classification: 'still-open', method: 'deterministic' };
}

/**
 * Build a `classifyOpenFindings` classifier from the deterministic floor. `resolved`/`still-open`
 * pass through; `escalate` maps to `not-re-examined` UNLESS a judgment verdict for the finding was
 * supplied in `judged` (id → {classification, method?, evidence?}) — that is how the owning job's
 * budgeted judgment recheck (P3) feeds its out-of-band results back into the mechanical run-end
 * classification. So the free floor always runs; judgment only overrides the escalated tail.
 * @param {string} root
 * @param {{judged?: Record<string, any>, io?: object}} [opts]
 */
function floorClassifier(root, opts = {}) {
  const judged = opts.judged || {};
  return (finding) => {
    const floor = deterministicFloor(finding, root, opts.io);
    if (floor.classification === 'resolved' || floor.classification === 'still-open') return floor;
    const j = judged[finding.id];
    if (j && (j.classification === 'resolved' || j.classification === 'still-open')) {
      return j.classification === 'still-open' ? { classification: 'still-open', method: j.method || 'judgment' } : j;
    }
    return { classification: 'not-re-examined', method: 'skipped' };
  };
}

// ---- P3: budgeted judgment recheck (bounded, oldest-first) ---------------------------------

/**
 * Carve the recheck reserve from a job's token budget (spec P3). The reserve is taken BEFORE
 * new-claim discovery, so old open findings cannot be starved by a chatty night. `fraction` is
 * clamped to [0,1]; a non-finite budget yields a zero reserve.
 * @param {number} budgetTokens @param {number} fraction
 * @returns {{reserve:number, discovery:number}}
 */
function carveRecheckBudget(budgetTokens, fraction) {
  const b = Number.isFinite(budgetTokens) && budgetTokens > 0 ? budgetTokens : 0;
  const fr = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const reserve = Math.floor(b * fr);
  return { reserve, discovery: b - reserve };
}

/**
 * Plan which escalated findings the reserve reaches (spec P3): process oldest-first, spending a flat
 * `costPer` tokens each until the reserve is exhausted; everything the slice does not reach is
 * `not-re-examined`. Deterministic — `escalated` is expected oldest-first (as `openFindings` returns).
 * @param {any[]} escalated Findings the floor escalated, oldest-first.
 * @param {{reserve:number, costPer:number}} budget
 * @returns {{reached:any[], skipped:any[]}}
 */
function planRecheck(escalated, { reserve, costPer }) {
  const reached = [];
  const skipped = [];
  const cost = Number.isFinite(costPer) && costPer > 0 ? costPer : Infinity;
  let spent = 0;
  for (const f of escalated || []) {
    if (spent + cost <= reserve) { reached.push(f); spent += cost; }
    else skipped.push(f);
  }
  return { reached, skipped };
}

/**
 * Filter classification results to the rows not already in the ledger, keyed by (type,id,date) — so
 * a re-run (even a forced one) never rewrites or duplicates a historical classification row (spec P1
 * "exactly once", non-goal "no retroactive rewriting", NFR8). Story 9.3 widens the key with a
 * forced-run ordinal; for now (type,id,date) is the exactly-once unit. Preserves input order.
 * @param {Array<{row: object|null}>} results
 * @param {any[]} existingRows
 * @returns {object[]}
 */
function newClassificationRows(results, existingRows, ordinal = 0) {
  const have = new Set();
  const keyOf = (r) => `${r.type}|${r.id}|${r.date || ''}|${r.run_ordinal || 0}`;
  for (const r of existingRows || []) {
    if (r && (r.type === 'resolution' || r.type === 'recheck') && r.id) have.add(keyOf(r));
  }
  const rows = [];
  for (const res of results || []) {
    if (!res || !res.row) continue;
    // Stamp the run-ordinal only when > 0 so a first (unforced) run's rows stay byte-identical to
    // the 9.1 format; a forced re-run's rows carry their ordinal and so are a distinct exactly-once
    // unit (spec finding-lifecycle P6: exactly once per (id, date, run-ordinal)).
    const row = ordinal ? { ...res.row, run_ordinal: ordinal } : res.row;
    const key = keyOf(row);
    if (have.has(key)) continue;
    have.add(key);
    rows.push(row);
  }
  return rows;
}

// ---- P5/P6: patch preservation + forced-run ordinal ---------------------------------------

// A per-finding patch file name (spec finding-lifecycle P5): reconcile-<date>-<id>.patch. Named by
// finding id so it survives a same-date rewrite while its finding is open, and is GC-addressable by
// id once the finding closes.
const PATCH_NAME_RE = /^reconcile-\d{4}-\d{2}-\d{2}-(.+)\.patch$/;

/** Repo-relative per-finding patch path under the disposable runtime/out (spec P5). */
function patchFileFor(date, id) { return `.nightwatch/runtime/out/reconcile-${date}-${id}.patch`; }

/**
 * The run-ordinal for `date` (spec finding-lifecycle P6): how many collect-brief runs already
 * completed on that date. The first run of a night is ordinal 0; a forced same-date re-run is 1,
 * and so on. Run rows and classification rows are stamped with it so a forced re-run leaves its own
 * audit trace instead of being swallowed by the same-date guard — while unforced re-runs still
 * no-op (their guard blocks the whole append).
 * @param {any[]} rows @param {string} date @returns {number}
 */
function runOrdinal(rows, date) {
  let n = 0;
  for (const r of rows || []) if (r && r.type === 'run' && r.job === 'collect-brief' && r.date === date) n++;
  return n;
}

/**
 * Garbage-collect the staged patches of findings that are resolved or dismissed (spec P5): a patch
 * survives only while its finding is open, so once closed its per-finding patch file(s) — of any
 * date — are removed. Returns the sorted repo-relative paths removed, for the single Machine-notes
 * line the brief renders. Deterministic; deleting an absent file is a no-op. `remove:false` performs
 * the same match read-only (used to render the note before the guarded delete).
 * @param {string} root @param {Iterable<string>} closedIds
 * @param {{remove?:boolean}} [opts]
 * @returns {string[]}
 */
function gcPatches(root, closedIds, opts = {}) {
  const remove = opts.remove !== false;
  const ids = closedIds instanceof Set ? closedIds : new Set(closedIds || []);
  if (!ids.size) return [];
  const dir = outDir(root);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const removed = [];
  for (const name of names) {
    const m = name.match(PATCH_NAME_RE);
    if (!m || !ids.has(m[1])) continue;
    if (remove) { try { fs.unlinkSync(path.join(dir, name)); } catch { /* already gone */ } }
    removed.push(`.nightwatch/runtime/out/${name}`);
  }
  return removed.sort();
}

/**
 * Summarize a night's classification results into the lifecycle counts P4 renders as one
 * Machine-notes line ("N open: k re-observed, m resolved, j still-open, i not-re-examined"). Pure;
 * the brief rendering itself lands in Story 10.6. Exposed here so the arithmetic has one home.
 * @param {Array<{classification: string}>} results
 */
function lifecycleCounts(results) {
  const c = { open: 0, 're-observed': 0, resolved: 0, 'still-open': 0, 'not-re-examined': 0 };
  for (const r of results || []) {
    c.open++;
    if (Object.prototype.hasOwnProperty.call(c, r.classification)) c[r.classification]++;
  }
  return c;
}

module.exports = {
  CLASSIFICATIONS, RECHECK_METHODS,
  openFindings, classifyOpenFindings, newClassificationRows, defaultClassifier, lifecycleCounts,
  deterministicFloor, floorClassifier, carveRecheckBudget, planRecheck,
  patchFileFor, runOrdinal, gcPatches,
};
