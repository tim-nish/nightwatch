# Dogfooding finding 0002 — Analysis scope includes development-only tooling by default

- **Date:** 2026-07-10
- **Command:** `/nightwatch` first run, on the Nightwatch repository itself
- **Classification:** UX / defaults issue — the ignore mechanism works as designed; the
  shipped default list is too narrow to express "product files only."
- **Status:** documented; proposed improvements specced in
  [`docs/specs/analysis-scope.md`](../specs/analysis-scope.md). No changes implemented.

## Observed behavior

On its first run, Nightwatch analyzed BMAD development artifacts — `_bmad/`, `_bmad-output/`,
`.claude/skills/bmad-*`, `q_a/` — together with the shipped product (`scripts/`, `commands/`,
`templates/`, `docs/`). These directories are planning provenance and workflow tooling for
*developing* Nightwatch; they are not part of what Nightwatch ships.

The adversarial verification pass did its job: the false positives arising from these files
were rejected and did not reach the brief. But the cost was already paid upstream — signal
extraction, surface inventory, judgment subagent attention, and verification subagent tokens
were all spent analyzing files that could never produce a real finding.

## Why this matters

- **Verification is the last line of defense, not a scoping mechanism.** Relying on the
  adversarial pass to filter out dev-tooling noise means paying full analysis cost for content
  that a one-line glob would have excluded before any token was spent. Budget consumed on
  `_bmad/**` is budget unavailable for real product surface within the same member caps.
- **The default ignore list only covers the classics.** The shipped default is
  `["dist/**", "vendor/**", "node_modules/**", ".git/**"]`
  (`templates/config.yaml`, `scripts/lib/config.js`). It expresses "build outputs and
  dependencies," not the broader category the first run actually needed: *development-only
  tooling that lives in the repo but is not the product*.
- **Every AI-assisted repo hits this.** BMAD is one instance of a general pattern: agent
  workspaces, planning artifacts, prompt/skill directories, scratch Q&A folders. Repos
  developed with AI tooling — Nightwatch's natural audience — will routinely contain these,
  so the default experience is noisy analysis on precisely the repos Nightwatch targets.
- **Noise risks are compounding.** Even when verification rejects the findings, dev-tooling
  analysis inflates run time (part of the 13-minute first run in finding
  [0001](0001-first-run-visibility.md)) and, if a false positive ever survives, spends the
  morning-attention budget the whole design exists to protect.

## Risks

- Wasted tokens and wall time on every run, scaling with the size of the dev-tooling tree.
- Member budget ceilings reached before real product files are fully analyzed.
- False positives that survive verification and pollute the brief.
- Users concluding Nightwatch "doesn't understand the repo" on first contact.

## Suggested improvements (summarized; full spec in `docs/specs/analysis-scope.md`)

1. **Distinguish product files from development-only tooling as a first-class concept**, not
   just a glob list — analysis applies to the product surface; everything else is out of
   scope unless explicitly enabled.
2. **Expand the default ignore set** to cover well-known non-product artifacts: generated
   files, development workspaces and planning artifacts (`_bmad/**`, `.claude/**`,
   `.github/**` workflows-adjacent tooling, etc.), vendor directories, caches, and
   Nightwatch's own `.nightwatch/**`.
3. **Detect candidate dev-tooling directories at `init` time** and confirm them with the
   human during the interview — the one moment a human is present to decide.
4. **Make inclusion explicit, not accidental**: analyzing a known dev-tooling directory
   should require an affirmative config entry, and the brief should state what was excluded
   so scoping is never silent.
