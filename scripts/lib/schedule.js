// @ts-check
'use strict';
// schedule.js — the deterministic scheduling core of /nightwatch (story 4.1, FR28/FR31).
//
// Everything here is a pure function of (state.json, config, date, force): it decides WHICH
// member jobs are due tonight and in WHAT order, and it maintains the human-inspectable cadence
// cursors in `.nightwatch/state.json`. The command prompt runs the plan's members as subagents;
// this module owns none of that — only the due/plan/idempotency decision and the cursor read/write.
//
// Execution order is fixed by the findings-file contract (§6): repo-reconcile → arch-review
// (only if its weekly cursor is due) → release-progress (last, so it consumes tonight's findings)
// → collect-brief (always, so a partial night still emits a brief). Cadence answers "is this job
// scheduled tonight"; idempotency (a separate gate, keyed on state.json + the dated brief) answers
// "did we already do tonight's run" — a second same-night invocation is a no-op unless `--force`.
const path = require('path');
const { nwDir, runtimeDir, readJSONSafe, writeJSON, exists } = require('./util');

/** @typedef {import('./types').Config} Config */
/** @typedef {import('./types').NightwatchState} NightwatchState */
/** @typedef {import('./types').JobCursor} JobCursor */

const STATE_SCHEMA = 1;

// Fixed dependency order. arch-review sits between so release-progress always runs last and
// therefore consumes whatever findings JSON tonight produced (§6). collect-brief is appended by
// planRun() and is not a cadence-gated member — it always attempts a (possibly stub) brief.
const ORDERED_MEMBERS = Object.freeze(['repo-reconcile', 'arch-review', 'release-progress']);

const CADENCE_DAYS = Object.freeze({ nightly: 1, weekly: 7 });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Cadence cursors live under the disposable `runtime/` boundary and are named `cursors.json` — the
// machine's cursor no longer name-collides with the human's STATE.md (spec runtime-layout P1). The
// export name stays `statePath` for its callers; the legacy `.nightwatch/state.json` is read as a
// fallback and migrated by `init --update` in Story 9.5.
function statePath(root) { return path.join(runtimeDir(root), 'cursors.json'); }
function legacyStatePath(root) { return path.join(nwDir(root), 'state.json'); }

/** Whole-day distance between two ISO `YYYY-MM-DD` dates (b - a). NaN inputs yield Infinity. */
function daysBetween(a, b) {
  if (!DATE_RE.test(String(a)) || !DATE_RE.test(String(b))) return Infinity;
  const ta = Date.parse(a + 'T00:00:00Z');
  const tb = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.round((tb - ta) / 86400000);
}

/** ISO date `days` after `date` (both UTC). */
function addDays(date, days) {
  const t = Date.parse(date + 'T00:00:00Z') + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Cadence period for a job in whole days; an unknown cadence degrades to nightly (1). */
function cadenceDays(cadence) {
  return CADENCE_DAYS[cadence] || CADENCE_DAYS.nightly;
}

/**
 * The date a cursor is next due, given its cadence and last run — a legible field a human can
 * read straight out of state.json. Never-run cursors are due immediately (return `date`).
 * @param {JobCursor} cursor @param {string} date @returns {string}
 */
function nextDue(cursor, date) {
  if (cursor.last_run == null) return date;
  return addDays(cursor.last_run, cadenceDays(cursor.cadence));
}

/**
 * Is a single job scheduled to run on `date`? Cadence-only decision (idempotency is separate):
 *  - never run  → due
 *  - already ran on `date` → not due, unless `force` (a forced re-run repeats tonight's plan)
 *  - otherwise  → due once `cadenceDays` have elapsed since `last_run`
 * @param {JobCursor} cursor @param {string} date @param {boolean} [force]
 * @returns {boolean}
 */
function jobDue(cursor, date, force) {
  if (!cursor || cursor.last_run == null) return true;
  if (cursor.last_run === date) return !!force; // ran tonight → only a forced run repeats it
  return daysBetween(cursor.last_run, date) >= cadenceDays(cursor.cadence);
}

/** Fresh state.json seeded from config cadence, all cursors never-run. */
function defaultState(config) {
  const cadence = (config && config.cadence) || {};
  /** @type {Record<string, JobCursor>} */
  const jobs = {};
  for (const job of ORDERED_MEMBERS) {
    jobs[job] = { cadence: cadence[job] || 'nightly', last_run: null, runs: 0, next_due: null };
  }
  return { schema: STATE_SCHEMA, updated: null, last_brief_date: null, jobs };
}

/**
 * Resolve and read the cadence cursors (spec runtime-layout P2): `runtime/cursors.json` when present,
 * else the legacy `.nightwatch/state.json`. Returns the parsed state plus the resolved source
 * (`runtime` | `legacy` | null) so a caller can report which layout it read — a pure read that never
 * writes, so a legacy install keeps its cadence with zero behavior change until a confirmed migration.
 * @param {string} root @returns {{ state: NightwatchState | null, source: 'runtime'|'legacy'|null }}
 */
function readStateResolved(root) {
  let raw = readJSONSafe(statePath(root));
  if (raw && typeof raw === 'object') return { state: /** @type {NightwatchState} */ (raw), source: 'runtime' };
  raw = readJSONSafe(legacyStatePath(root));
  if (raw && typeof raw === 'object') return { state: /** @type {NightwatchState} */ (raw), source: 'legacy' };
  return { state: null, source: null };
}

/** Read the cadence cursors (runtime, with legacy fallback), or null if absent. Never writes. */
function readState(root) {
  return readStateResolved(root).state;
}

function writeState(root, state) { writeJSON(statePath(root), state); }

/**
 * Reconcile an on-disk (or fresh) state against config so cadence changes in config.yaml take
 * effect and any newly-added member gets a cursor. Cadence is config-owned; run history is
 * state-owned. Returns a new state object (does not mutate the input). Deterministic.
 * @param {NightwatchState | null} state @param {Config} config @returns {NightwatchState}
 */
function reconcileState(state, config) {
  const base = state && state.jobs ? state : defaultState(config);
  const cadence = (config && config.cadence) || {};
  /** @type {Record<string, JobCursor>} */
  const jobs = {};
  for (const job of ORDERED_MEMBERS) {
    const prior = /** @type {Partial<JobCursor>} */ (base.jobs[job] || {});
    jobs[job] = {
      cadence: cadence[job] || prior.cadence || 'nightly',
      last_run: prior.last_run != null ? prior.last_run : null,
      runs: Number.isFinite(prior.runs) ? prior.runs : 0,
      next_due: prior.next_due != null ? prior.next_due : null,
    };
  }
  return {
    schema: STATE_SCHEMA,
    updated: base.updated != null ? base.updated : null,
    last_brief_date: base.last_brief_date != null ? base.last_brief_date : null,
    jobs,
  };
}

/**
 * The deterministic run plan for `date`: which members are due (in fixed order), which are
 * skipped and why, and the ordered step list the command executes (`due… + collect-brief`).
 * Pure — no I/O, no mutation of `state`.
 * @param {{ state: NightwatchState | null, config: Config, date: string, force?: boolean }} opts
 * @returns {{ due: string[], skipped: {job:string,reason:string,next_due:string}[], steps: string[] }}
 */
function planRun({ state, config, date, force = false }) {
  const st = reconcileState(state, config);
  const due = [];
  const skipped = [];
  for (const job of ORDERED_MEMBERS) {
    const cursor = st.jobs[job];
    if (jobDue(cursor, date, force)) {
      due.push(job);
    } else {
      const reason = cursor.last_run === date
        ? `already ran ${date}`
        : `${cursor.cadence}: next due ${nextDue(cursor, date)} (last ran ${cursor.last_run})`;
      skipped.push({ job, reason, next_due: nextDue(cursor, date) });
    }
  }
  return { due, skipped, steps: [...due, 'collect-brief'] };
}

/**
 * Has tonight's run already completed? The idempotency sentinel is state.json's
 * `last_brief_date` plus the dated brief on disk — either one being `date` means a full run
 * happened tonight (§6), so a re-invocation without `--force` must no-op.
 * @param {NightwatchState | null} state @param {string} root @param {string} date
 * @returns {boolean}
 */
function alreadyRanTonight(state, root, date) {
  if (state && state.last_brief_date === date) return true;
  return exists(path.join(nwDir(root), 'briefs', `${date}.md`));
}

/**
 * Record a completed member run into `state` (mutates + returns it): advance the cursor's
 * `last_run`, bump `runs`, and recompute the legible `next_due`. Called once per due job after
 * the subagent finishes (cadence bookkeeping only — crash/timeout accounting is story 4.3).
 * @param {NightwatchState} state @param {string} job @param {string} date @returns {NightwatchState}
 */
function recordRun(state, job, date) {
  const cursor = state.jobs[job];
  if (!cursor) return state;
  cursor.last_run = date;
  cursor.runs = (Number.isFinite(cursor.runs) ? cursor.runs : 0) + 1;
  cursor.next_due = nextDue(cursor, date);
  return state;
}

/** Stamp a finished night: set the idempotency sentinel and the `updated` marker. */
function markBriefed(state, date) {
  state.last_brief_date = date;
  state.updated = date;
  return state;
}

module.exports = {
  STATE_SCHEMA, ORDERED_MEMBERS, CADENCE_DAYS, DATE_RE,
  statePath, legacyStatePath, daysBetween, addDays, cadenceDays, nextDue, jobDue,
  defaultState, readState, readStateResolved, writeState, reconcileState, planRun,
  alreadyRanTonight, recordRun, markBriefed,
};
