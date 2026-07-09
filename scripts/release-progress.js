#!/usr/bin/env node
// @ts-check
'use strict';
// release-progress.js — the deterministic layer of /release-progress (story 2.2, FR16/FR17).
// It maintains RELEASE.md, the living distance-to-release tracker, so "what's done / what
// remains / what's next / how close" survives between sessions without human bookkeeping.
//
// RELEASE.md is NEVER written directly here — every mutation flows through the tracking store
// (openTracker): items are upserted/completed, the status log is appended, and the frontmatter
// (progress/updated/notice) is rewritten via store.updateHead(). The store is the sole sanctioned
// writer (spec §5), which is what guarantees Notes + human-authored item text stay byte-preserved
// and that an unchanged night round-trips byte-identically. releaseProgress() is the pure compute
// (returns a result object and, as a side effect of the store, refreshes RELEASE.md); main() adds
// the findings JSON output the brief/ledger consume.
const path = require('path');
const yaml = require('js-yaml');
const { parseArgs, repoRoot, todayISO, outDir, writeJSON, readFileSafe, exists } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { releaseChecks } = require('./release-checks');
const { openTracker, itemId } = require('./lib/tracker');
const { makeFinding, SCHEMA_VERSION, readFindings } = require('./lib/findings');

// The header note stamped when there is no declared `release:` block — a coarse, honest signal
// that "done" is only generic hygiene until a human declares a real definition of done in STATE.md.
const GENERIC_NOTICE = 'generic criteria — declare `release:` in STATE.md for a real definition of done';

const STALE_TAG = '(stale? — confirm)';

// Generic release-hygiene checks → tracked items. `concept` folds a declared definition-of-done
// line onto the same criterion so we never carry two items for one thing. `file` is the concrete
// pointer a Next action references. Sections drive both display and the progress denominator.
const CHECK_META = {
  license: { section: 'documentation', title: 'Ship a LICENSE file', file: 'LICENSE', concept: /licen[sc]e/i },
  readme_sections: { section: 'documentation', title: 'README covers install and quickstart', file: 'README.md', concept: /readme|install|quick\s?start|getting started|usage/i },
  changelog: { section: 'documentation', title: 'Maintain a CHANGELOG', file: 'CHANGELOG.md', concept: /changelog|release notes/i },
  ci_present: { section: 'implementation', title: 'CI runs the test suite', file: '.github/workflows/ci.yml', concept: /\bci\b|continuous integration|pipeline|workflow/i },
  no_secrets: { section: 'implementation', title: 'No committed secrets', file: null, concept: /secret|credential|api[ -]?key|password/i },
  todo_threshold: { section: 'implementation', title: 'TODO/FIXME markers under threshold', file: null, concept: /\btodo\b|fixme|tech debt/i },
  version_tag: { section: 'implementation', title: 'Version matches the latest release tag', file: 'package.json', concept: /\bversion\b|semver|\btag\b/i },
};

const SECTION_RANK = { blockers: 0, implementation: 1, documentation: 2 };

// Which foreign job a promoted item's source finding came from, keyed by the finding-id prefix
// (findings.js JOB_PREFIX). Only these two jobs feed the promotion sections, so a promoted item
// can be traced back to the job that must rerun before we may auto-clear it.
const PROMOTION_JOB_BY_PREFIX = { RC: 'repo-reconcile', AR: 'arch-review' };
// A machine-promoted blocker/decision renders as `<title> (<FINDING-ID>)` (a rendered evidence
// suffix may follow after a round-trip); this recovers the source finding id from anywhere in it.
const PROMOTED_ID_RE = /\(([A-Z]{2}-[0-9a-f]{6})\)/;
// A round-tripped item title absorbs the rendered `— evidence: …` tail; strip it before re-upsert.
const EVIDENCE_SUFFIX_RE = /\s+—\s+evidence:.*$/;

function evStr(ev) {
  if (!Array.isArray(ev) || !ev.length) return '';
  return ev.map((e) => (e && e.line != null ? `${e.path}:${e.line}` : e && e.path)).filter(Boolean).join(', ');
}

function parseFrontmatter(text) {
  const m = text && text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try { const d = yaml.load(m[1]); return d && typeof d === 'object' ? d : {}; } catch { return {}; }
}

function isStale(title) { return String(title).includes(STALE_TAG); }

// Path-like tokens a human wrote into an item title, used to (a) point a Next action at a real
// file and (b) judge an item stale when every path it names has vanished from the repo. Purely
// syntactic and conservative: version numbers and URLs are excluded so we never false-flag.
function pathTokens(s) {
  const out = [];
  const seen = new Set();
  const re = /(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b/g;
  for (const m of String(s).matchAll(re)) {
    const t = m[0];
    if (seen.has(t) || /^https?:/i.test(t) || /^\d/.test(t) || !/[A-Za-z]/.test(t)) continue;
    seen.add(t); out.push(t);
  }
  return out;
}

function firstPathToken(s) { const t = pathTokens(s); return t.length ? t[0] : null; }

/** A human item looks stale when it names at least one path and none of them exist any more. */
function looksStale(root, title) {
  const toks = pathTokens(title);
  if (!toks.length) return false;
  return toks.every((t) => !exists(path.join(root, t)));
}

/** True when a declared definition-of-done line expresses a criterion a generic check covers. */
function matchesGenericConcept(crit) {
  for (const meta of Object.values(CHECK_META)) if (meta.concept.test(crit)) return true;
  return false;
}

function dodKey(crit) { return 'release:dod:' + String(crit).trim().toLowerCase().replace(/\s+/g, ' '); }

function safeReadForeign(root, job, date) {
  try { return readFindings(root, job, date); } catch { return null; }
}

/** Assemble the ≤12-line brief section (progress delta, new blockers/decisions, next actions). */
function buildBrief({ progress, prevProgress, target, newBlockers, newDecisions, next, noChange }) {
  const delta = progress - prevProgress;
  const L = [];
  L.push(`Release progress: ${progress}% toward ${target} (${delta >= 0 ? '+' : ''}${delta} since last run).`);
  L.push(`New blockers: ${newBlockers.length ? newBlockers.map((f) => f.id).join(', ') : 'none'}.`);
  L.push(`New decisions: ${newDecisions.length ? newDecisions.map((f) => f.id).join(', ') : 'none'}.`);
  if (noChange) L.push('No material change since last run.');
  L.push('Next actions:');
  if (next.length) next.slice(0, 3).forEach((c, i) => L.push(`  ${i + 1}. ${c.title} → ${c.pointer}`));
  else L.push('  (none — release criteria satisfied)');
  return L.slice(0, 12);
}

function briefFinding(brief) {
  return makeFinding('release-progress', {
    kind: 'info', severity: 2, action: 'none', verified: true,
    title: brief[0], locus: 'release:brief', evidence: [{ path: 'RELEASE.md' }], extra: { brief },
  });
}

/**
 * Reconcile RELEASE.md against reality and (via the store) rewrite it.
 * @param {string} root
 * @param {{ date?: string, force?: boolean }} [opts]
 * @returns {{ wrote: boolean, malformed?: boolean, idempotent?: boolean, noChange: boolean,
 *   date: string, progress: number|null, prevProgress: number, delta: number, notice: string|null,
 *   brief: string[], findings: any[], degraded: string[] }}
 */
function releaseProgress(root, opts = {}) {
  const date = opts.date || todayISO();
  const force = !!opts.force;
  const { config, release, degraded } = loadConfig(root);

  const releaseText = readFileSafe(path.join(root, 'RELEASE.md'));

  // Malformed hand-edit (frontmatter fence gone) → write nothing, surface a setup finding, and let
  // the brief carry last night's snapshot with an explicit staleness notice (normative safety rule).
  // Frontmatter can't be parsed structurally here, so recover progress/updated best-effort by line.
  if (releaseText != null && !/^---\n[\s\S]*?\n---/.test(releaseText)) {
    const f = makeFinding('release-progress', {
      kind: 'setup', severity: 3, action: 'daytime-task', verified: false,
      title: 'RELEASE.md lost its frontmatter — repair by hand or delete it to regenerate',
      locus: 'release:malformed', evidence: [{ path: 'RELEASE.md' }], extra: undefined,
    });
    const pm = releaseText.match(/^progress:\s*(\d+)\b/m);
    const um = releaseText.match(/^updated:\s*(\d{4}-\d{2}-\d{2})\b/m);
    const staleProgress = pm ? Number(pm[1]) : null;
    const asOf = um ? um[1] : 'an unknown date';
    const brief = [
      'RELEASE.md is malformed (frontmatter broken by a hand-edit) — showing last night\'s snapshot; NOT refreshed tonight.',
      staleProgress != null
        ? `Release progress (stale, as of ${asOf}): ${staleProgress}%.`
        : 'Release progress (stale): unknown — last snapshot unreadable.',
      'Repair RELEASE.md by hand or delete it to regenerate; nothing was written tonight.',
    ];
    return { wrote: false, malformed: true, noChange: false, date, progress: staleProgress, prevProgress: 0, delta: 0, notice: null, brief, findings: [f, briefFinding(brief)], degraded };
  }

  const prevFm = parseFrontmatter(releaseText != null ? releaseText : '');
  const prevProgress = Number.isFinite(prevFm.progress) ? Number(prevFm.progress) : 0;
  // js-yaml coerces an unquoted ISO date to a Date, so read `updated:` as raw text instead.
  const fmText = releaseText ? (releaseText.match(/^---\n([\s\S]*?)\n---/) || [null, ''])[1] : '';
  const um = fmText.match(/^updated:\s*(\d{4}-\d{2}-\d{2})\b/m);
  const prevUpdated = um ? um[1] : null;
  const prevTarget = typeof prevFm.target === 'string' ? prevFm.target : null;
  const declaredTarget = release && typeof release.target === 'string' ? release.target : null;
  const target = declaredTarget || prevTarget || 'public release';
  const notice = release ? null : GENERIC_NOTICE;

  const store = openTracker(root, config);
  const priorItems = store.listItems();
  const priorById = new Map(priorItems.map((it) => [it.id, it]));

  // Idempotency: RELEASE.md already carries tonight's date and --force absent → confirm state,
  // no changes; the flush round-trips byte-identically.
  if (releaseText != null && prevUpdated === date && !force) {
    const next = readNextActions(store);
    store.flush();
    const brief = buildBrief({ progress: prevProgress, prevProgress, target, newBlockers: [], newDecisions: [], next, noChange: true });
    return { wrote: true, idempotent: true, noChange: true, date, progress: prevProgress, prevProgress, delta: 0, notice, brief, findings: [briefFinding(brief)], degraded };
  }

  const machineIds = new Set();
  const nextCandidates = [];
  const completedThisRun = [];
  const addedThisRun = [];

  // ---- Generic hygiene checks → items (source of "done" #2) ----
  const checks = releaseChecks(root).checks;
  for (const check of checks) {
    const meta = CHECK_META[check.id];
    if (!meta || check.status === 'skip') continue;
    const key = 'release:check:' + check.id;
    const id = itemId(key);
    machineIds.add(id);
    const evidence = Array.isArray(check.evidence) ? check.evidence : [];
    const prior = priorById.get(id);
    if (check.status === 'pass') {
      if (!prior || prior.status !== 'done') {
        store.upsertItem({ key, title: meta.title, section: meta.section, evidence });
        store.completeItem(id);
        completedThisRun.push({ title: meta.title, evidence });
      }
    } else {
      if (!prior) { store.upsertItem({ key, title: meta.title, section: meta.section, evidence }); addedThisRun.push(id); }
      const pointer = meta.file || (evidence[0] && evidence[0].path) || 'the repo';
      nextCandidates.push({ rank: SECTION_RANK[meta.section], id, title: meta.title, pointer });
    }
  }

  // ---- Declared definition of done (source #1), merged without duplicating a generic item ----
  const dod = release && Array.isArray(release.definition_of_done) ? release.definition_of_done : [];
  for (const crit of dod) {
    if (typeof crit !== 'string' || matchesGenericConcept(crit)) continue;
    const key = dodKey(crit);
    const id = itemId(key);
    machineIds.add(id);
    const prior = priorById.get(id);
    if (!prior) { store.upsertItem({ key, title: crit, section: 'implementation' }); addedThisRun.push(id); }
    // A declared DoD item's completion is human judgment — never auto-checked here.
    if (!prior || prior.status !== 'done') {
      nextCandidates.push({ rank: SECTION_RANK.implementation, id, title: crit, pointer: firstPathToken(crit) || 'STATE.md release.definition_of_done' });
    }
  }

  // ---- Promote tonight's other jobs' findings (standalone-safe: only if present) ----
  // Track which foreign jobs actually produced a doc tonight and which finding ids they carried.
  // Both are needed to auto-clear a promoted item safely: a source finding counts as "resolved"
  // only when its emitting job reran tonight (doc present) and no longer lists the id — an absent
  // doc means the job did not run, which we must not mistake for a fixed finding.
  const newBlockers = [];
  const newDecisions = [];
  const foreign = [];
  const foreignJobsSeen = new Set();
  const foreignIds = new Set();
  for (const job of ['repo-reconcile', 'arch-review']) {
    const doc = safeReadForeign(root, job, date);
    if (doc && Array.isArray(doc.findings)) {
      foreignJobsSeen.add(job);
      for (const f of doc.findings) { foreign.push(f); if (f && f.id) foreignIds.add(f.id); }
    }
  }
  for (const f of foreign) {
    if (f.severity === 1 || f.kind === 'blocker') {
      const key = 'release:blocker:' + f.id;
      const id = itemId(key);
      machineIds.add(id);
      if (!priorById.get(id)) { store.upsertItem({ key, title: `${f.title} (${f.id})`, section: 'blockers', evidence: f.evidence || [] }); newBlockers.push(f); }
      nextCandidates.push({ rank: SECTION_RANK.blockers, id, title: f.title, pointer: (f.evidence && f.evidence[0] && f.evidence[0].path) || f.id });
    } else if (f.action === 'human-decision' || f.kind === 'decision') {
      const key = 'release:decision:' + f.id;
      const id = itemId(key);
      machineIds.add(id);
      if (!priorById.get(id)) { store.upsertItem({ key, title: `${f.title} (${f.id})`, section: 'decisions', evidence: f.evidence || [] }); newDecisions.push(f); }
    }
  }

  // ---- Clear promoted items whose source finding no longer appears → move to Done ----
  // A machine-promoted blocker/decision (key release:blocker:<id> / release:decision:<id>, title
  // carrying `(<FINDING-ID>)`) whose source finding is absent from tonight's rerun clears itself
  // with closing evidence. A human-added item in these sections has no reconstructable id and is
  // NEVER auto-completed. Items still reported tonight were re-upserted above (id already in
  // machineIds) and are skipped here.
  for (const it of priorItems) {
    if (it.status !== 'open' || machineIds.has(it.id)) continue;
    if (it.section !== 'blockers' && it.section !== 'decisions') continue;
    const m = it.title.match(PROMOTED_ID_RE);
    if (!m) continue; // human-added item in a promotion section — leave it alone
    const fid = m[1];
    const keyPrefix = it.section === 'blockers' ? 'release:blocker:' : 'release:decision:';
    if (itemId(keyPrefix + fid) !== it.id) continue; // title id doesn't reconstruct this item → human
    const srcJob = PROMOTION_JOB_BY_PREFIX[fid.slice(0, 2)];
    if (!srcJob || !foreignJobsSeen.has(srcJob)) continue; // emitting job didn't rerun → can't tell
    if (foreignIds.has(fid)) continue; // still reported tonight → still active
    // Closing evidence: the rerun that no longer reports the finding. Strip any round-tripped
    // evidence tail from the title so the Done line carries one clean evidence pointer.
    const title = it.title.replace(EVIDENCE_SUFFIX_RE, '');
    const evidence = [{ path: `.nightwatch/out/${srcJob}-${date}.json` }];
    store.upsertItem({ id: it.id, title, section: it.section, evidence });
    store.completeItem(it.id);
    machineIds.add(it.id);
    completedThisRun.push({ title, evidence });
  }

  // ---- Human items: never deleted; a plainly-obsolete one is tagged, not removed ----
  const staleTagged = [];
  for (const it of priorItems) {
    if (it.status !== 'open' || machineIds.has(it.id) || isStale(it.title)) continue;
    if (it.section === 'next') continue; // machine-owned slot, handled below
    if (looksStale(root, it.title)) {
      store.upsertItem({ id: it.id, title: `${it.title} ${STALE_TAG}` });
      staleTagged.push(it.id);
    } else if (['blockers', 'implementation', 'documentation'].includes(it.section)) {
      nextCandidates.push({ rank: SECTION_RANK[it.section], id: it.id, title: it.title, pointer: firstPathToken(it.title) || 'RELEASE.md' });
    }
  }

  // ---- Next actions (top 3), each pointing at a concrete file/spec ----
  nextCandidates.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const top = nextCandidates.slice(0, 3);
  for (let i = 0; i < 3; i++) {
    const key = 'release:next:' + (i + 1);
    const id = itemId(key);
    const cand = top[i];
    const title = cand ? `${cand.title} → ${cand.pointer}` : '(no further release-blocking items)';
    const prior = priorById.get(id);
    if (cand) machineIds.add(id);
    if (!cand && !prior) continue; // don't create empty slots on a clean repo
    if (!prior || prior.title !== title) store.upsertItem({ key, title, section: 'next' });
  }

  // ---- Coarse, honest progress: fraction of (definition-of-done items + blockers) resolved ----
  const tracked = store.listItems().filter((it) => ['implementation', 'documentation', 'blockers'].includes(it.section) && !isStale(it.title));
  const doneCount = tracked.filter((it) => it.status === 'done').length;
  const progress = tracked.length ? Math.round((100 * doneCount) / tracked.length) : 0;
  const delta = progress - prevProgress;

  const targetChanged = declaredTarget != null && declaredTarget !== prevTarget;
  const material = releaseText == null || progress !== prevProgress || targetChanged
    || completedThisRun.length > 0 || addedThisRun.length > 0 || staleTagged.length > 0
    || newBlockers.length > 0 || newDecisions.length > 0;

  if (material) {
    for (const c of completedThisRun) {
      const ev = evStr(c.evidence);
      store.appendStatus(`completed: ${c.title}${ev ? ` (evidence: ${ev})` : ''}`, date);
    }
    if (!completedThisRun.length) {
      store.appendStatus(`progress ${progress}% (${delta >= 0 ? '+' : ''}${delta}); ${addedThisRun.length} new item(s)`, date);
    }
    // Mirror the human-declared target from STATE (never invent one) alongside progress/notice.
    const headPatch = { progress, updated: date, notice };
    if (declaredTarget != null) headPatch.target = declaredTarget;
    store.updateHead(headPatch);
  } else {
    // No-change night: only `updated:` and one "no change" status line change.
    store.appendStatus('no change', date);
    store.updateHead({ updated: date });
  }

  store.flush();

  const brief = buildBrief({ progress, prevProgress, target, newBlockers, newDecisions, next: top, noChange: !material });
  const findings = [briefFinding(brief), ...(store.setupFindings || [])];
  return { wrote: true, noChange: !material, date, progress, prevProgress, delta, notice, brief, findings, degraded };
}

/** Read the current Next actions back out of the store (for the idempotent-run brief). */
function readNextActions(store) {
  return store.listItems({ status: 'open' }).filter((it) => it.section === 'next').map((it) => {
    const m = it.title.split(' → ');
    return { title: m[0], pointer: m[1] || '' };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const res = releaseProgress(root, { date, force: !!args.force });
  const doc = {
    schema: SCHEMA_VERSION, job: 'release-progress', date,
    degraded: res.degraded || [], findings: res.findings || [],
    progress: res.progress, delta: res.delta, wrote: res.wrote, no_change: res.noChange,
  };
  writeJSON(path.join(outDir(root), `release-progress-${date}.json`), doc);
  process.stdout.write(JSON.stringify({ progress: res.progress, delta: res.delta, no_change: res.noChange, wrote: res.wrote, brief_lines: (res.brief || []).length }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { releaseProgress };
