# Extractor adapters (§2.6)

A **tool adapter** is a thin module that wraps one mature, host-provided analyzer and turns
its native output into the normalized signals schema (`scripts/lib/signals.js`). The judgment
layer consumes only that schema, never a tool's raw output, so adapters are swappable and a new
ecosystem never touches core code.

Drop one `<name>.js` file here implementing the four-function contract and the runner
(`scripts/extract-signals.js`) picks it up automatically. Files starting with `_` are ignored.

## Contract

Every adapter exports these four functions:

| Function | Returns | Purpose |
|---|---|---|
| `detect(repo)` | `boolean` | Does this ecosystem apply? Lockfile/manifest heuristics (`package.json`, `pyproject.toml`, …). |
| `available(repo)` | `boolean` | Can the tool run **locally**? Resolve the binary in the host repo's `node_modules/.bin` (or a venv `bin/`), then `PATH`. **Never** `npx`-fetch, install, or hit the network. |
| `run(repo, config)` | `{ signals: Signal[], tool?: string }` | Invoke the tool, parse its output, return signals conforming to the shared schema. `tool` is `"<name>@<version>"` for the `sources` list. |
| `explain()` | `{ name, tool?, install?, summary? }` | Identity + one-line description + install hint, used for `degraded` notices, the `sources` list, and `/nightwatch init`. `name` is the extractor id. |

## Runner behavior (what you can rely on)

- **Detected but unavailable** → a `degraded` entry naming the tool with your `install` hint,
  plus a `setup`-kind finding suggesting the daytime install, emitted **once per repo**.
- **Crash or unparsable output** → your adapter's signals are dropped with a `degraded` notice;
  every other extractor still contributes.
- **Available** → `run()` is invoked and its signals merge into `out/signals-<date>.json`; the
  runner re-validates each signal and drops (never throws on) a malformed one.

Signals must use a `kind` from `KINDS` in `scripts/lib/signals.js` (e.g. `layering-violation`,
`cycle`, `orphan`) and a `confidence` of `exact` (the analyzer proved it) or `heuristic`.

v0.1 adapters live alongside this file: `node-depcruise.js` (dependency-cruiser) and
`python-importlinter.js` (import-linter).
