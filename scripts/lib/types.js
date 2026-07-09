// @ts-check
'use strict';
// Shared JSDoc typedefs — the single source of truth for the data shapes that cross
// script boundaries (spec §2.5). This file ships no runtime behavior; it exists so every
// `// @ts-check`ed script can `import('./types')` the same Finding / FindingsDoc / Config
// shapes instead of redeclaring them, and so `tsc --noEmit` checks them uniformly.

/**
 * @typedef {'repo-reconcile' | 'arch-review' | 'release-progress' | 'nightwatch'} Job
 * A member job / command that produces findings.
 */

/**
 * @typedef {'drift' | 'arch' | 'blocker' | 'decision' | 'setup' | 'info'} FindingKind
 * Category of a finding (see findings.js KINDS).
 */

/**
 * @typedef {'patch-available' | 'human-decision' | 'daytime-task' | 'none'} FindingAction
 * What the human is expected to do with a finding (see findings.js ACTIONS).
 */

/**
 * @typedef {1 | 2 | 3 | 4 | 5} Severity
 * Finding severity, 1 (lowest) .. 5 (highest).
 */

/**
 * A structured evidence locus — a concrete, checkable pointer into the repo. Findings store
 * these objects (never bare strings) so every consumer reads `.path`/`.line` uniformly.
 * @typedef {object} EvidenceItem
 * @property {string} path Repo-relative path the finding points at.
 * @property {number} [line] 1-based line number, when the evidence is line-specific.
 */

/**
 * A single finding — the inter-command interface unit. Ids are stable across runs so the
 * ledger can dedupe, count recurrence, and track acted-on/dismissed state.
 * @typedef {object} Finding
 * @property {string} id Stable id: PREFIX-<6 hex of sha1(kind|locus)>.
 * @property {FindingKind} kind
 * @property {Severity} severity
 * @property {string} title
 * @property {EvidenceItem[]} evidence Concrete, checkable `{path, line}` evidence loci.
 * @property {FindingAction} action
 * @property {boolean} verified Whether the finding survived adversarial verification.
 */

/**
 * The per-job findings document written to `.nightwatch/out/<job>-<date>.json`.
 * @typedef {object} FindingsDoc
 * @property {number} schema Major schema version; consumers reject a higher major (FR6).
 * @property {Job} job
 * @property {string} date ISO `YYYY-MM-DD`.
 * @property {string[]} degraded Human-readable notes about signals that could not be gathered.
 * @property {Finding[]} findings
 */

/**
 * An append-only ledger row (`.nightwatch/ledger.jsonl`).
 * @typedef {object} LedgerRow
 * @property {string} type Row type, e.g. `"finding"`.
 * @property {string} [id] Finding id, when `type === "finding"`.
 * @property {string} [date]
 * @property {Job} [job]
 */

/**
 * Parsed `--key value` / `--flag` argv (see util.parseArgs). Positional args land in `_`;
 * every other key is a raw flag value the caller coerces as needed.
 * @typedef {{ _: string[], [key: string]: any }} Args
 */

/**
 * A layering rule declared once in `layers:` and compiled per-adapter downstream.
 * @typedef {object} LayerRule
 * @property {string} [name] Layer name.
 * @property {string} [path] Glob selecting the files in this layer.
 * @property {string[]} [may_depend_on] Names of layers this layer may import.
 */

/**
 * Merged operational config (shipped DEFAULTS <- config.yaml <- STATE.md yaml block).
 * @typedef {object} Config
 * @property {Record<string, string>} cadence
 * @property {Record<string, number>} budget_tokens
 * @property {Record<string, string>} effort
 * @property {{ brief_total: number, reconcile: number, arch_candidates: number }} caps
 * @property {string[]} ignore
 * @property {string} extractors
 * @property {LayerRule[]} layers
 * @property {{ disable: string[] }} release_checks
 * @property {boolean} patch_branch
 * @property {number} timeout_minutes
 */

/**
 * Result of loadConfig(root): the merged config plus the human-declared, never-inferred
 * facts read from STATE.md, and any degradation notes.
 * @typedef {object} LoadedConfig
 * @property {Config} config
 * @property {Record<string, any> | null} authority
 * @property {string | null} phase
 * @property {Record<string, any> | null} release
 * @property {LayerRule[]} layers
 * @property {string[]} degraded
 * @property {{ config_yaml: boolean, state_md: boolean }} sources
 * @property {string | null} [stateText]
 */

module.exports = {};
