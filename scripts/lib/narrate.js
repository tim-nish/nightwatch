// @ts-check
'use strict';
// narrate.js — one-line-per-event lifecycle narration for interactive /nightwatch runs (FR39).
//
// Every narration line is derived from the SAME fact the command records in
// out/run-status-<date>.json ({job, status, tokens, note}), so live narration and the persisted
// record can never disagree — these formatters are the single source. Presentation only: nothing
// here changes what runs or what is scheduled. Scheduled runs stay silent; the facts still land in
// run-status and can be re-rendered from it (narrateRunStatus) after the fact.
const STATUS_ICON = Object.freeze({ ok: '✓', crashed: '✗', timeout: '⏱', skipped: '–' });

/**
 * Member-started line — from the plan's member detail. Exactly one line.
 * @param {{job:string, budget_tokens?:number|null, effort?:string|null}} m
 */
function memberStartLine(m) {
  const parts = [];
  if (m && Number.isFinite(m.budget_tokens)) parts.push(`budget ${m.budget_tokens}`);
  if (m && m.effort) parts.push(`effort ${m.effort}`);
  const meta = parts.length ? ` (${parts.join(', ')})` : '';
  return `▶ ${m.job} started${meta}`;
}

/**
 * Member-finished line — from a run-status job record. Exactly one line, carrying the recorded
 * status, token spend, and any note verbatim (FR39). An unknown status still renders one line.
 * @param {{job:string, status:string, tokens?:number|null, note?:string|null}} j
 */
function memberDoneLine(j) {
  const icon = STATUS_ICON[j.status] || '•';
  let line = `${icon} ${j.job} ${j.status}`;
  if (Number.isFinite(j.tokens)) line += ` (${j.tokens} tokens)`;
  if (j.note) line += ` — ${j.note}`;
  return line;
}

/**
 * Brief-assembly line — from the collect-brief result. Exactly one line.
 * @param {{shown?:number, total?:number}} [b]
 */
function briefLine(b) {
  if (b && Number.isFinite(b.shown) && Number.isFinite(b.total)) {
    return `▤ brief assembled (${b.shown}/${b.total} findings shown)`;
  }
  return '▤ brief assembled';
}

/**
 * Reconstruct the narration a run would print, purely from the persisted run-status doc: one line
 * per finished member (in recorded order) plus a brief line when a `brief` record is present.
 * Because the live narration and this reconstruction both read the same fields, they carry
 * identical facts — this is what proves narration and the record agree (FR39). Read-only.
 * @param {{jobs?: any[], brief?: any}} runStatus
 * @returns {string[]}
 */
function narrateRunStatus(runStatus) {
  const lines = [];
  for (const j of (runStatus && runStatus.jobs) || []) lines.push(memberDoneLine(j));
  if (runStatus && runStatus.brief) lines.push(briefLine(runStatus.brief));
  return lines;
}

module.exports = { STATUS_ICON, memberStartLine, memberDoneLine, briefLine, narrateRunStatus };
