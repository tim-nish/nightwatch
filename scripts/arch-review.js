#!/usr/bin/env node
// @ts-check
'use strict';
// arch-review.js — the DETERMINISTIC scaffolding of the /arch-review judgment layer (story 5.5).
//
// Nightwatch's rule is: deterministic work lives in scripts, JUDGMENT lives in agent prompts.
// This script does the mechanical half — consume signals, assemble architecture CANDIDATES,
// apply the corroboration rule, estimate each candidate's blast radius, lay out a both-sides
// argument scaffold, rank phase-aware, and emit stable-id findings (recorded in the ledger for
// recurrence). It NEVER decides: `verified` defaults false on every finding and is flipped to
// true only by the adversarial refute pass (a second subagent, described in
// commands/arch-review.md). Only verified candidates enter the morning brief.
//
// Writes nothing outside `.nightwatch/` (NFR3): the findings doc under out/, and finding rows
// appended to the ledger. Two runs on an unchanged repo yield identical finding ids (NFR8).
const path = require('path');
const { parseArgs, guardCli, repoRoot, todayISO, walkFiles, topSegment, writeJSON, outDir, readFileSafe } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { analysisExcludeGlobs } = require('./lib/scope');
const { archSignals } = require('./arch-signals');
const { extractSignals } = require('./extract-signals');
const { inventory } = require('./surface-inventory');
const { makeFinding, recurrenceCounts, readLedger, appendLedger, SCHEMA_VERSION } = require('./lib/findings');
const { runOrdinal } = require('./lib/lifecycle');

// Concern classes drive phase-weighted ranking. "overengineering" = unnecessary abstraction /
// redundancy the maintainer over-built; "coupling" = drift and cross-boundary entanglement.
const COUPLING = new Set(['layering-violation', 'cycle', 'hidden-coupling', 'growth-trend', 'hotspot']);
function classOf(kind) { return COUPLING.has(kind) ? 'coupling' : 'overengineering'; }

// When several signals land on one locus, the most actionable kind names the candidate.
const KIND_RANK = new Map([
  ['layering-violation', 0], ['cycle', 1], ['speculation', 2], ['unused-export', 3],
  ['orphan', 4], ['duplication', 5], ['hidden-coupling', 6], ['growth-trend', 7], ['hotspot', 8],
]);
function kindRank(kind) { const r = KIND_RANK.get(kind); return r == null ? 99 : r; }

/** Phase-weighted tier for a concern class. prototype/building lift overengineering; hardening/
 *  released lift coupling; no phase → neutral (all tiers equal). Additive and dominant so phase
 *  can reorder candidates regardless of raw signal strength. */
function phaseTier(cls, phase) {
  const p = String(phase || '').toLowerCase();
  if (p === 'prototype' || p === 'building') return cls === 'overengineering' ? 2 : 1;
  if (p === 'hardening' || p === 'released') return cls === 'coupling' ? 2 : 1;
  return 1; // no phase (or unknown) → neutral
}

/** A candidate's default verdict from its primary signal kind. The agent may override after the
 *  both-sides argument; an abstraction the architecture doc mandates is `keep`. */
function verdictFor(kind, mandated) {
  if (mandated) return 'keep';
  if (kind === 'layering-violation' || kind === 'cycle' || kind === 'hidden-coupling') return 'decision-needed';
  return 'simplification-candidate';
}

/** Finding shape (kind/action/severity) for a verdict. */
function findingMeta(verdict) {
  if (verdict === 'keep') return { kind: 'info', action: 'none', severity: 5 };
  if (verdict === 'decision-needed') return { kind: 'decision', action: 'human-decision', severity: 3 };
  return { kind: 'arch', action: 'daytime-task', severity: 4 }; // simplification-candidate
}

function titleFor(verdict, primary, needs) {
  const nm = primary.name ? `"${primary.name}" ` : '';
  const suffix = needs ? ' (needs corroboration)' : '';
  if (verdict === 'keep') return `keep ${nm}— mandated by the architecture authority doc` + suffix;
  if (verdict === 'decision-needed') return `decision needed: ${primary.detail}` + suffix;
  return `simplification candidate: ${primary.detail}` + suffix;
}

/** Union evidence loci across a candidate's signals, deduped and sorted (deterministic). */
function dedupeEvidence(list) {
  const seen = new Set();
  const out = [];
  for (const e of list || []) {
    if (!e || !e.path) continue;
    const k = e.path + ':' + (e.line == null ? '' : e.line);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e.line != null ? { path: e.path, line: e.line } : { path: e.path });
  }
  out.sort((a, b) => a.path.localeCompare(b.path) || (a.line || 0) - (b.line || 0));
  return out;
}

const TEST_RE = /(\.(test|spec)\.[^/]+$)|(^|\/)(tests?|__tests__)\//;

/**
 * Estimate a candidate's blast radius deterministically from its evidence + the surface
 * inventory: how many source files it touches, how many test files live in the same module(s),
 * and how much exported public surface sits in the touched files.
 */
function blastRadius(evidencePaths, inv, allFiles) {
  const files = [...new Set(evidencePaths.filter(Boolean))];
  const modules = new Set(files.map(topSegment));
  const tests = allFiles.filter((f) => TEST_RE.test(f) && modules.has(topSegment(f))).length;
  const fileSet = new Set(files);
  const surface = new Set();
  for (const e of inv.exports || []) if (fileSet.has(e.path)) surface.add(e.path + '::' + e.name);
  return { files: files.length, tests, public_surface: surface.size };
}

/**
 * Deterministic scaffolding for /arch-review. Returns the assembled candidates as findings
 * (all `verified:false`), the phase-ranked order, and the cap/appendix split. Writes the
 * findings doc + ledger rows (both under `.nightwatch/`). The agent's adversarial pass then
 * verifies survivors and only those render in the brief.
 * @param {string} root
 * @param {{ date?: string, force?: boolean }} [opts]
 */
function archReview(root, opts = {}) {
  const date = opts.date || todayISO();
  const { config, phase, authority } = loadConfig(root);
  const cap = (config.caps && Number.isFinite(config.caps.arch_candidates)) ? config.caps.arch_candidates : 7;
  const allFiles = walkFiles(root, analysisExcludeGlobs(config));
  const inv = inventory(root);
  const arch = archSignals(root);
  const degraded = [...(arch.degraded || [])];

  // Normalized signals (universal-git built-in + tool adapters). We fold in only genuinely
  // INDEPENDENT tool-adapter signals (source !== 'universal-git'): the git-derived observations
  // are already represented via arch-signals, so re-adding them would fabricate corroboration
  // from what is really one source. Adapter signals (dependency-cruiser / import-linter) are
  // exact and independent — real corroboration.
  /** @type {{ signals: any[], degraded: string[], findings: any[] }} */
  let ext = { signals: [], degraded: [], findings: [] };
  try { ext = extractSignals(root, { date, config }); } catch (e) { degraded.push('extract-signals failed: ' + ((e && e.message) || e)); }
  for (const d of ext.degraded || []) degraded.push(d);

  const archDoc = authority && authority.architecture && authority.architecture.artifact;
  const archDocText = archDoc ? (readFileSafe(path.join(root, archDoc)) || '').toLowerCase() : '';

  // ---- Assemble observations, keyed by a stable locus, from the signal set ----
  const byLocus = new Map();
  const addObs = (locus, obs) => { const a = byLocus.get(locus) || []; a.push(obs); byLocus.set(locus, a); };

  // Speculation — a one-implementer interface/protocol. Heuristic (regex-detected).
  for (const s of arch.speculation) {
    addObs(`path:${s.path}`, { kind: 'speculation', confidence: 'heuristic', source: 'arch:speculation',
      evidence: [{ path: s.path, line: s.line }], detail: `${s.name}: ${s.note}`, name: s.name });
  }
  // Duplication — same name defined across modules. Heuristic; keyed by the module pair so an
  // independent import-overlap signal about the same pair corroborates it.
  for (const d of arch.duplication) {
    const mods = [...new Set(d.modules)].sort();
    addObs(`pair:${mods.join('|')}`, { kind: 'duplication', confidence: 'heuristic', source: 'arch:duplication',
      evidence: d.evidence, detail: `function/def "${d.name}" defined across modules ${mods.join(', ')}`, name: d.name });
  }
  // Import-set overlap — heavy shared dependencies between two modules. Heuristic corroboration.
  for (const o of arch.import_overlap) {
    const mods = [o.module_a, o.module_b].sort();
    addObs(`pair:${mods.join('|')}`, { kind: 'hidden-coupling', confidence: 'heuristic', source: 'arch:import-overlap',
      evidence: [], detail: `modules ${mods.join(' & ')} share ${o.shared} imports (jaccard ${o.jaccard})`, name: null });
  }
  // Hidden coupling — cross-boundary co-change from git. Heuristic.
  for (const c of arch.hidden_coupling) {
    const mods = [c.module_a, c.module_b].sort();
    addObs(`pair:${mods.join('|')}`, { kind: 'hidden-coupling', confidence: 'heuristic', source: 'arch:coupling',
      evidence: [{ path: c.a }, { path: c.b }], detail: `${c.module_a} and ${c.module_b} co-change across a boundary in ${c.commits} commits`, name: null });
  }
  // Layering violations — declared may_depend_on breached. EXACT (mechanical against declared rules).
  for (const l of arch.layering) {
    addObs(`layer:${l.from_layer}->${l.to_layer}`, { kind: 'layering-violation', confidence: 'exact', source: 'arch:layering',
      evidence: l.evidence, detail: `an import from layer "${l.from_layer}" into "${l.to_layer}" violates declared may_depend_on`, name: null });
  }
  // Growth — a churn hotspot the architecture doc never mentions. Heuristic.
  for (const h of (arch.growth && arch.growth.unmentioned_hotspots) || []) {
    addObs(`path:${h.path}`, { kind: 'growth-trend', confidence: 'heuristic', source: 'arch:growth',
      evidence: [{ path: h.path }], detail: `hotspot ${h.path} (churn ${h.count}) is absent from the declared architecture doc`, name: null });
  }
  // Independent tool-adapter signals (exact, non-git) — real corroboration / new candidates.
  for (const sg of ext.signals || []) {
    if (sg.source === 'universal-git') continue; // already covered by arch-signals; avoid double-count
    const paths = (sg.evidence || []).map((e) => e.path).filter(Boolean);
    if (['speculation', 'unused-export', 'orphan'].includes(sg.kind)) {
      if (!paths[0]) continue;
      addObs(`path:${paths[0]}`, { kind: sg.kind, confidence: sg.confidence, source: sg.source, evidence: sg.evidence, detail: sg.detail, name: null });
    } else if (['hidden-coupling', 'layering-violation', 'cycle', 'duplication'].includes(sg.kind)) {
      const mods = [...new Set(paths.map(topSegment))].sort();
      if (sg.kind === 'layering-violation' && mods.length >= 2) addObs(`layer:${mods[0]}->${mods[1]}`, { kind: sg.kind, confidence: sg.confidence, source: sg.source, evidence: sg.evidence, detail: sg.detail, name: null });
      else if (mods.length >= 2) addObs(`pair:${mods.join('|')}`, { kind: sg.kind, confidence: sg.confidence, source: sg.source, evidence: sg.evidence, detail: sg.detail, name: null });
      else if (paths[0]) addObs(`path:${paths[0]}`, { kind: sg.kind, confidence: sg.confidence, source: sg.source, evidence: sg.evidence, detail: sg.detail, name: null });
    }
  }

  // Recurrence (prior ledger appearances) read BEFORE we append this run's rows.
  const recur = recurrenceCounts(root);

  // ---- Turn each locus into a candidate finding ----
  const candidates = [];
  for (const [locus, obsList] of [...byLocus.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    obsList.sort((x, y) => kindRank(x.kind) - kindRank(y.kind) || x.source.localeCompare(y.source) || x.detail.localeCompare(y.detail));
    const primary = obsList[0];
    const sources = [...new Set(obsList.map((o) => o.source))].sort();
    const hasExact = obsList.some((o) => o.confidence === 'exact');

    // Corroboration rule (FR23): an exact signal grounds a candidate on its own; a heuristic
    // signal grounds one ONLY with corroboration — a second INDEPENDENT signal (distinct source)
    // about the same locus — otherwise the candidate is marked needs-corroboration.
    const grounded = hasExact || sources.length >= 2;
    const needsCorroboration = !grounded;

    const evidence = dedupeEvidence(obsList.flatMap((o) => o.evidence || []));
    const evidencePaths = evidence.map((e) => e.path);
    const mandated = primary.kind === 'speculation' && primary.name && archDocText.includes(String(primary.name).toLowerCase());
    const verdict = verdictFor(primary.kind, mandated);
    const cls = classOf(primary.kind);
    const meta = findingMeta(verdict);
    const severity = needsCorroboration ? Math.min(meta.severity + 1, 5) : meta.severity;
    const blast = blastRadius(evidencePaths, inv, allFiles);

    // Both-sides argument scaffold — deterministic placeholders the agent replaces during the
    // judgment/adversarial pass (it argues earns-its-keep vs speculative before a verdict).
    const argument = {
      for: `earns its keep if: ${primary.detail} is intentional — cite the architecture authority doc.`,
      against: `speculative if: ${primary.detail} has no mandate and a single (or no) consumer.`,
      filled_by: 'agent',
    };

    const extra = {
      verdict,
      candidate_kind: primary.kind,
      concern_class: cls,
      locus,
      mandated: !!mandated,
      corroboration: { grounded, needs_corroboration: needsCorroboration, sources, signal_count: obsList.length },
      blast_radius: blast,
      argument,
      detail: primary.detail,
    };

    const finding = makeFinding('arch-review', {
      kind: meta.kind, severity, title: titleFor(verdict, primary, needsCorroboration),
      evidence, action: meta.action, verified: false, locus, extra,
    });

    const recurrence = recur.get(finding.id) || 0;
    const base = hasExact ? 3 : (grounded ? 2 : 1);
    const score = phaseTier(cls, phase) * 10 + base + Math.min(recurrence, 5) * 0.5;
    candidates.push({ id: finding.id, score, finding, candidate_kind: primary.kind, concern_class: cls, needs_corroboration: needsCorroboration, recurrence });
  }

  // Phase-weighted deterministic rank; stable tiebreak by id.
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const briefCandidates = candidates.slice(0, cap);
  const appendix = candidates.slice(cap).map((c) => c.id);

  // Findings doc: ranked candidate findings first, then any extractor setup findings (missing
  // tool installs surfaced by extract-signals, already tagged job 'arch-review').
  const findings = candidates.map((c) => c.finding);
  for (const f of ext.findings || []) findings.push(f);

  const doc = {
    schema: SCHEMA_VERSION, job: 'arch-review', date, phase: phase || null, degraded,
    caps: { arch_candidates: cap },
    brief: briefCandidates.map((c) => c.id),
    appendix,
    findings,
  };
  writeJSON(path.join(outDir(root), `arch-review-${date}.json`), doc);

  // Record findings in the ledger for recurrence (same append-only ledger the tracking store
  // reads). Guard against double-append on a same-date re-run so a re-run doesn't inflate counts.
  // Same-date guard, unless forced (spec finding-lifecycle P6): a forced re-run's run row is
  // appended with `forced: true` rather than swallowed, so the ledger never misses a run.
  const ledger = readLedger(root);
  const already = ledger.some((r) => r.type === 'run' && r.job === 'arch-review' && r.date === date);
  if (!already || opts.force === true) {
    // Authoritative post-judgment run row, one per (job, date, run_ordinal) (FR94) — see reconcile.js.
    /** @type {any} */
    const runRow = { type: 'run', date, job: 'arch-review', candidates: candidates.length, brief: briefCandidates.length, degraded: degraded.length, run_ordinal: runOrdinal(ledger, date) };
    if (opts.force === true) runRow.forced = true;
    /** @type {any[]} */
    const rows = [runRow];
    for (const f of findings) rows.push({ type: 'finding', date, job: 'arch-review', id: f.id, kind: f.kind, severity: f.severity });
    appendLedger(root, rows);
  }

  return {
    date, phase: phase || null, degraded, findings,
    ranked: candidates.map((c) => ({ id: c.id, candidate_kind: c.candidate_kind, concern_class: c.concern_class, score: c.score, needs_corroboration: c.needs_corroboration })),
    brief: briefCandidates.map((c) => c.id),
    appendix,
    cap,
  };
}

function main() {
  const args = guardCli('arch-review.js', process.argv.slice(2), ['date', 'force']);
  const root = repoRoot(args);
  const date = todayISO(args);
  const res = archReview(root, { date, force: !!args.force });
  process.stdout.write(JSON.stringify({
    candidates: res.ranked.length, brief: res.brief.length, appendix: res.appendix.length,
    findings: res.findings.length, degraded: res.degraded,
  }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { archReview };
