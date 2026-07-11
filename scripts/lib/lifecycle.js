// @ts-check
'use strict';
// Finding lifecycle (spec docs/specs/finding-lifecycle.md §P1): open-finding carry-forward and
// per-run classification. Pure functions over ledger rows — no I/O. The tracking store is the sole
// ledger reader/writer (§2.7); these helpers compute the open set from the rows the store hands
// them and produce the classification rows the store appends. So an unfixed finding can never
// simply not be looked at again (0019 gap 1): every run ends by classifying every open finding.
//
// Story 9.1 ships P1 (carry-forward + classification rows + exactly-once). The deterministic
// re-verification floor (P2) and budgeted judgment recheck (P3) that decide `resolved` vs
// `still-open` plug into `classifyOpenFindings`'s `classifier` in Story 9.2; until then the default
// classifier is deliberately conservative — "when in doubt, not-re-examined" (spec non-goals).

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
function openFindings(rows) {
  const closed = new Set();
  for (const r of rows || []) {
    if (!r || !r.id) continue;
    if (r.type === 'resolution') closed.add(r.id);
    else if (r.type === 'feedback' && String(r.verdict) === 'dismissed') closed.add(r.id);
  }
  const byId = new Map();
  for (const r of rows || []) {
    if (!r || r.type !== 'finding' || !r.id || closed.has(r.id)) continue;
    const d = r.date || '';
    const cur = byId.get(r.id);
    if (!cur) {
      byId.set(r.id, { id: r.id, kind: r.kind, severity: r.severity, firstDate: d, lastDate: d });
    } else {
      if (d && (!cur.firstDate || d < cur.firstDate)) cur.firstDate = d;
      if (d && d > cur.lastDate) cur.lastDate = d;
      if (cur.kind == null && r.kind != null) cur.kind = r.kind;
      if (cur.severity == null && r.severity != null) cur.severity = r.severity;
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

/**
 * Filter classification results to the rows not already in the ledger, keyed by (type,id,date) — so
 * a re-run (even a forced one) never rewrites or duplicates a historical classification row (spec P1
 * "exactly once", non-goal "no retroactive rewriting", NFR8). Story 9.3 widens the key with a
 * forced-run ordinal; for now (type,id,date) is the exactly-once unit. Preserves input order.
 * @param {Array<{row: object|null}>} results
 * @param {any[]} existingRows
 * @returns {object[]}
 */
function newClassificationRows(results, existingRows) {
  const have = new Set();
  const keyOf = (r) => `${r.type}|${r.id}|${r.date || ''}`;
  for (const r of existingRows || []) {
    if (r && (r.type === 'resolution' || r.type === 'recheck') && r.id) have.add(keyOf(r));
  }
  const rows = [];
  for (const res of results || []) {
    if (!res || !res.row) continue;
    const key = keyOf(res.row);
    if (have.has(key)) continue;
    have.add(key);
    rows.push(res.row);
  }
  return rows;
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
};
