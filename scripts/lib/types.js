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
 * The morning rendering of a finding — the imperative action a tired reader takes, authored by
 * the job's judgment layer and reviewed by the same adversarial pass as the finding (spec §2.5,
 * FR54). Optional: a finding without a `next_step` still renders, falling back to its `title`.
 * @typedef {object} NextStep
 * @property {string} summary Imperative, verb-first, ≤ 60 chars — what the human *does*.
 * @property {string} [command] Copy-pasteable command, when one action resolves the finding.
 * @property {number} [effort_min] Coarse effort estimate in minutes, rendered `~N min`.
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
 * @property {NextStep} [next_step] Optional morning-action rendering (FR54); falls back to `title`.
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
 * @typedef {'re-observed' | 'resolved' | 'still-open' | 'not-re-examined'} FindingClassification
 * The per-run lifecycle state of an open finding (spec docs/specs/finding-lifecycle.md P1). Every
 * open finding is classified into exactly one of these each run, so an unfixed finding can never
 * silently drop out: `re-observed` (found again — a plain finding row), `resolved` (evidence gone —
 * a `resolution` row), `still-open` (evidence present — a `recheck` row), `not-re-examined`
 * (budget/scope didn't reach it — a `recheck` row, method `skipped`).
 */

/**
 * A `resolution` ledger row: a finding whose underlying issue evidence shows is gone (spec P1). Its
 * presence removes the finding from the open set — it will not be carried forward again.
 * @typedef {object} ResolutionRow
 * @property {'resolution'} type
 * @property {string} id Finding id being resolved.
 * @property {string} date ISO `YYYY-MM-DD` of the run that resolved it.
 * @property {string} evidence Human-readable evidence clause naming why it is considered resolved.
 */

/**
 * A `recheck` ledger row: an open finding was re-examined this run but not resolved (spec P1/P2/P3).
 * @typedef {object} RecheckRow
 * @property {'recheck'} type
 * @property {string} id Finding id re-examined.
 * @property {string} date ISO `YYYY-MM-DD`.
 * @property {'deterministic' | 'judgment' | 'skipped'} method How it was re-examined: the free
 *   deterministic floor, a budgeted judgment recheck, or `skipped` (budget/scope did not reach it).
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
 * @property {string} release_path Repo-relative path the tracker writes/reads RELEASE.md at
 *   (default `.nightwatch/RELEASE.md`; a legacy root `RELEASE.md` is adopted until migrated).
 * @property {{ backend: string }} tracking Tracking store backend selector (default `markdown`).
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
 * @property {{ config_yaml: boolean, state_md: boolean, state_md_path: string | null }} sources
 * @property {string | null} [stateText]
 */

/**
 * A per-member cadence cursor inside `.nightwatch/state.json`. Deliberately human-inspectable:
 * a reader sees the job's cadence, when it last ran, how many times, and the date it is next due
 * — the whole "what ran / what's due / why skipped" decision is auditable without re-deriving it.
 * @typedef {object} JobCursor
 * @property {string} cadence Scheduling cadence, `nightly` or `weekly`.
 * @property {string | null} last_run ISO `YYYY-MM-DD` the job last ran, or null if never.
 * @property {number} runs Count of recorded runs (monotonic).
 * @property {string | null} next_due ISO date the cursor is next due — a legible convenience field.
 */

/**
 * `.nightwatch/state.json` — the orchestrator's durable scheduling state (FR31). Cadence cursors
 * plus `last_brief_date` make cadence decisions and per-night idempotency mechanical and legible.
 * @typedef {object} NightwatchState
 * @property {number} schema Major schema version of this state file.
 * @property {string | null} updated ISO date the state was last written.
 * @property {string | null} last_brief_date ISO date of the most recent completed night; the
 *   idempotency sentinel — a same-date re-invocation without `--force` is a no-op.
 * @property {Record<string, JobCursor>} jobs Per-member cadence cursors, keyed by job name.
 */

/**
 * @typedef {'ok' | 'crashed' | 'timeout' | 'skipped'} RunStatusState
 * Outcome of one member subagent in a night's run. Anything other than `ok` renders as a single
 * line in the brief's "Failures & degraded notices" section and never blocks the remaining jobs
 * (§6 failure handling, FR32): `crashed`/`timeout` mark a member that died or was killed at
 * `timeout_minutes`; `skipped` marks a member cadence left out tonight.
 */

/**
 * One member's outcome line inside `.nightwatch/out/run-status-<date>.json`.
 * @typedef {object} RunStatusJob
 * @property {Job} job
 * @property {RunStatusState} status
 * @property {string} [note] One-line human-readable note (e.g. why it crashed or was killed).
 * @property {number} [tokens] Tokens the member spent, when known.
 */

/**
 * `.nightwatch/out/run-status-<date>.json` — the /nightwatch command's per-member outcome record
 * for one night. Written by the subagent runner (the kill/crash bookkeeping is the command's job),
 * read by collect-brief.js so a crashed or timed-out member degrades to exactly one brief line
 * (§6 failure handling, FR32).
 * @typedef {object} RunStatusDoc
 * @property {RunStatusJob[]} jobs
 */

/**
 * @typedef {'exact' | 'heuristic'} Confidence
 * How much to trust a signal: `exact` is a mechanical fact, `heuristic` is an inference.
 */

/**
 * @typedef {'hotspot' | 'hidden-coupling' | 'growth-trend' | 'file-tree' | 'readme' | 'todo-density'} SignalKind
 * Category of an architecture-review signal (see signals.js KINDS).
 */

/**
 * A normalized architecture-review signal: an evidence-backed candidate observation an
 * extractor surfaces for the judgment layer to argue over (spec §2.6, FR8). Extractors emit
 * only this shape; the judgment layer consumes only this shape.
 * @typedef {object} Signal
 * @property {SignalKind} kind
 * @property {Confidence} confidence
 * @property {EvidenceItem[]} evidence Structured `{path, line?}` loci backing the signal.
 * @property {string} detail Human-readable description of the observation.
 * @property {string} source Name of the extractor that produced it (e.g. `universal-git`).
 */

/**
 * A signals document written to `.nightwatch/out/signals-<date>.json` — the inter-command
 * interface between extractors and the judgment layer (FR8).
 * @typedef {object} SignalsDoc
 * @property {number} schema Major schema version; consumers refuse a higher major.
 * @property {string} job Always `signals`.
 * @property {string} date
 * @property {{ extractor: string, tool?: string }[]} sources Extractors that contributed this
 *   run (`{extractor}` for built-ins, `{extractor, tool}` for tool adapters).
 * @property {string[]} degraded Setup/skip notices (e.g. shallow history).
 * @property {Signal[]} signals
 */

module.exports = {};
