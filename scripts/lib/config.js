// @ts-check
'use strict';
// Config precedence: shipped defaults <- .nightwatch/config.yaml <- STATE.md yaml block.
// STATE.md owns declarations no tool can infer (authority, phase, release); config.yaml
// owns operational knobs. Both optional; absent/empty is valid.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { readFileSafe } = require('./util');

/** @typedef {import('./types').Config} Config */
/** @typedef {import('./types').LoadedConfig} LoadedConfig */

const DEFAULTS = Object.freeze({
  cadence: { 'repo-reconcile': 'nightly', 'arch-review': 'weekly', 'release-progress': 'nightly' },
  budget_tokens: { 'repo-reconcile': 200000, 'arch-review': 300000, 'release-progress': 100000 },
  effort: { 'repo-reconcile': 'medium', 'arch-review': 'high', 'release-progress': 'medium' },
  caps: { brief_total: 25, reconcile: 10, arch_candidates: 7 },
  ignore: ['dist/**', 'vendor/**', 'node_modules/**', '.git/**'],
  extractors: 'auto',
  layers: [],
  release_checks: { disable: [] },
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
  const sources = { config_yaml: false, state_md: false };

  const cfgPath = path.join(root, '.nightwatch', 'config.yaml');
  const cfgText = readFileSafe(cfgPath);
  if (cfgText != null) {
    try {
      const parsed = yaml.load(cfgText);
      if (isPlainObject(parsed)) { deepMerge(config, parsed); sources.config_yaml = true; }
      else if (parsed != null) degraded.push('.nightwatch/config.yaml is not a mapping; ignored');
    } catch (e) { degraded.push('.nightwatch/config.yaml unparseable: ' + e.message); }
  }

  const stateText = readFileSafe(path.join(root, 'STATE.md'));
  const { data: state, error: stateErr } = parseStateBlock(stateText);
  if (stateErr) degraded.push('STATE.md yaml block unparseable: ' + stateErr);
  let authority = null, phase = null, release = null;
  if (isPlainObject(state)) {
    sources.state_md = true;
    if (isPlainObject(state.authority)) authority = state.authority;
    if (typeof state.phase === 'string') phase = state.phase;
    if (isPlainObject(state.release)) release = state.release;
    // config.yaml keys may also appear in STATE.md for the operational knobs; STATE wins.
    for (const k of ['layers', 'ignore', 'caps', 'cadence', 'extractors']) {
      if (state[k] !== undefined) { const patch = {}; patch[k] = state[k]; deepMerge(config, patch); }
    }
  }

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
