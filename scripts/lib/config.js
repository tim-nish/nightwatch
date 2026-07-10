// @ts-check
'use strict';
// Config precedence: shipped defaults <- .nightwatch/config.yaml <- STATE.md yaml block.
// STATE.md owns declarations no tool can infer (authority, phase, release); config.yaml
// owns operational knobs. Both optional; absent/empty is valid.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { readFileSafe } = require('./util');
const { DEFAULT_IGNORE, DEFAULT_DEV_TOOLING, extendGlobs } = require('./scope');

/** @typedef {import('./types').Config} Config */
/** @typedef {import('./types').LoadedConfig} LoadedConfig */

const DEFAULTS = Object.freeze({
  cadence: { 'repo-reconcile': 'nightly', 'arch-review': 'weekly', 'release-progress': 'nightly' },
  budget_tokens: { 'repo-reconcile': 200000, 'arch-review': 300000, 'release-progress': 100000 },
  effort: { 'repo-reconcile': 'medium', 'arch-review': 'high', 'release-progress': 'medium' },
  caps: { brief_total: 25, reconcile: 10, arch_candidates: 7 },
  // Two-tier analysis scoping (FR42). Shipped defaults live in scope.js; user lists in
  // config.yaml/STATE.md EXTEND these rather than replace them, and loadConfig resolves the
  // extended lists below. `ignore` = never look; `dev_tooling` = develops the product but is
  // not the product.
  ignore: DEFAULT_IGNORE.slice(),
  dev_tooling: DEFAULT_DEV_TOOLING.slice(),
  extractors: 'auto',
  layers: [],
  release_checks: { disable: [] },
  tracking: { backend: 'markdown' },
  // Where the release tracker writes/reads RELEASE.md (repo-relative). Default keeps it under
  // .nightwatch/ so a fresh install leaves zero Nightwatch-owned files in the repo root (FR49);
  // set to `RELEASE.md` (root) or e.g. `docs/RELEASE.md` for a public deliverable. Resolution and
  // the legacy-root fallback live in tracker.js (releaseReadPath/releaseWritePath).
  release_path: '.nightwatch/RELEASE.md',
  patch_branch: false,
  timeout_minutes: 30,
});

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function isPlainObject(x) { return x && typeof x === 'object' && !Array.isArray(x); }

/** Deep merge src over dst (arrays replace, objects merge). Returns dst. */
function deepMerge(dst, src) {
  if (!isPlainObject(src)) return dst;
  for (const k of Object.keys(src)) {
    if (isPlainObject(src[k]) && isPlainObject(dst[k])) deepMerge(dst[k], src[k]);
    else dst[k] = clone(src[k]);
  }
  return dst;
}

/** Extract the single fenced ```yaml block from STATE.md text, parsed. Prose is ignored. */
function parseStateBlock(text) {
  if (!text) return { data: null, error: null };
  const m = text.match(/```ya?ml\s*\n([\s\S]*?)```/i);
  if (!m) return { data: null, error: null };
  try { return { data: yaml.load(m[1]) || {}, error: null }; }
  catch (e) { return { data: null, error: e.message }; }
}

/**
 * Load merged config for a repo root.
 * @param {string} root
 * @returns {LoadedConfig}
 */
function loadConfig(root) {
  const degraded = [];
  const config = clone(DEFAULTS);
  const sources = { config_yaml: false, state_md: false, state_md_path: null };
  // Raw user scoping lists, captured before deepMerge (which would replace the arrays). The two
  // scoping tiers EXTEND their shipped defaults instead of replacing them (FR42), so they are
  // resolved separately at the end. STATE.md wins over config.yaml, matching every other key.
  let rawIgnore, rawDevTooling;

  const cfgPath = path.join(root, '.nightwatch', 'config.yaml');
  const cfgText = readFileSafe(cfgPath);
  if (cfgText != null) {
    try {
      const parsed = yaml.load(cfgText);
      if (isPlainObject(parsed)) {
        if (parsed.ignore !== undefined) rawIgnore = parsed.ignore;
        if (parsed.dev_tooling !== undefined) rawDevTooling = parsed.dev_tooling;
        deepMerge(config, parsed); sources.config_yaml = true;
      } else if (parsed != null) degraded.push('.nightwatch/config.yaml is not a mapping; ignored');
    } catch (e) { degraded.push('.nightwatch/config.yaml unparseable: ' + e.message); }
  }

  // STATE.md read precedence: .nightwatch/STATE.md → legacy root STATE.md (FR48). The first that
  // exists is parsed; the resolved repo-relative path is recorded in `sources` for reporting.
  let statePath = null, stateText = null;
  for (const cand of ['.nightwatch/STATE.md', 'STATE.md']) {
    const text = readFileSafe(path.join(root, ...cand.split('/')));
    if (text != null) { statePath = cand; stateText = text; break; }
  }
  sources.state_md_path = statePath;
  const { data: state, error: stateErr } = parseStateBlock(stateText);
  if (stateErr) degraded.push('STATE.md yaml block unparseable: ' + stateErr);
  let authority = null, phase = null, release = null;
  if (isPlainObject(state)) {
    sources.state_md = true;
    if (isPlainObject(state.authority)) authority = state.authority;
    if (typeof state.phase === 'string') phase = state.phase;
    if (isPlainObject(state.release)) release = state.release;
    // config.yaml keys may also appear in STATE.md for the operational knobs; STATE wins.
    for (const k of ['layers', 'ignore', 'dev_tooling', 'caps', 'cadence', 'extractors']) {
      if (state[k] !== undefined) { const patch = {}; patch[k] = state[k]; deepMerge(config, patch); }
    }
    if (state.ignore !== undefined) rawIgnore = state.ignore;
    if (state.dev_tooling !== undefined) rawDevTooling = state.dev_tooling;
  }

  // Resolve the two scoping tiers: user lists extend the shipped defaults, `!pattern` re-includes
  // a default-excluded path (FR42). An absent key yields the defaults verbatim.
  config.ignore = extendGlobs(DEFAULT_IGNORE, rawIgnore);
  config.dev_tooling = extendGlobs(DEFAULT_DEV_TOOLING, rawDevTooling);

  return {
    config,
    authority,
    phase,
    release,
    layers: config.layers || [],
    degraded,
    sources,
    stateText,
  };
}

module.exports = { DEFAULTS, loadConfig, parseStateBlock, deepMerge };
