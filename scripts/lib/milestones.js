// @ts-check
'use strict';
// milestones.js — the release journey MODEL (spec docs/specs/release-journey.md P1). The maintainer
// declares an optional ordered `milestones:` list over their existing `definition_of_done`; this
// module parses it, validates it (declared, never inferred), and derives the done/current/next
// journey from tracker state. It ships pure functions only — no I/O, no tokens — so the tracker and
// brief (Stories 10.4/10.5/10.6) render a road that is the maintainer's judgment, not the tool's
// inference. The RELEASE.md road rendering itself lives in Story 10.4.
const { makeFinding } = require('./findings');

/** The declared `definition_of_done` list (strings only), or [] when absent. */
function definitionOfDone(release) {
  return release && Array.isArray(release.definition_of_done)
    ? release.definition_of_done.filter((c) => typeof c === 'string')
    : [];
}

/**
 * Normalize the optional `milestones:` list to `[{name, criteria:[text]}]` in FILE ORDER (spec P1:
 * file order is the journey order). A milestone needs a non-empty `name`; `criteria` are exact-text
 * references to `definition_of_done` entries. Absent/invalid → [] (fully valid, principle 5).
 * @param {any} release @returns {{name:string, criteria:string[]}[]}
 */
function parseMilestones(release) {
  const ms = release && Array.isArray(release.milestones) ? release.milestones : [];
  const out = [];
  for (const m of ms) {
    if (!m || typeof m.name !== 'string' || !m.name.trim()) continue;
    out.push({ name: m.name.trim(), criteria: Array.isArray(m.criteria) ? m.criteria.filter((c) => typeof c === 'string') : [] });
  }
  return out;
}

/**
 * Validate the declaration (spec P1): a `criteria` entry matching no DoD item is a dangling
 * reference; a DoD item referenced by no milestone is unreferenced (it renders under a trailing
 * "(not yet on the road)" group so nothing silently disappears). Pure.
 * @param {any} release
 * @returns {{ hasMilestones:boolean, milestones:{name:string,criteria:string[]}[], dod:string[], dangling:{milestone:string,criterion:string}[], unreferenced:string[] }}
 */
function validateMilestones(release) {
  const milestones = parseMilestones(release);
  const dod = definitionOfDone(release);
  const dodSet = new Set(dod);
  const referenced = new Set();
  const dangling = [];
  for (const m of milestones) {
    for (const c of m.criteria) {
      if (dodSet.has(c)) referenced.add(c);
      else dangling.push({ milestone: m.name, criterion: c });
    }
  }
  const unreferenced = dod.filter((c) => !referenced.has(c));
  return { hasMilestones: milestones.length > 0, milestones, dod, dangling, unreferenced };
}

function setup(locus, title) {
  return makeFinding('release-progress', {
    kind: 'setup', severity: 3, action: 'daytime-task', verified: true,
    title, locus, evidence: [{ path: 'STATE.md' }], extra: undefined,
  });
}

/**
 * The validation `setup` findings for a release declaration (spec P1). With `milestones:` declared,
 * one finding per dangling criterion and per unreferenced DoD item; without it (but with a DoD), a
 * single nudge to declare `milestones:` for a roadmap. No `release:` block, or no DoD → nothing.
 * Deterministic ordering (findings sorted by locus). Byte-stable ids (setup id keys on the locus).
 * @param {any} release @returns {import('./types').Finding[]}
 */
function milestoneFindings(release) {
  if (!release || typeof release !== 'object') return [];
  const v = validateMilestones(release);
  if (!v.hasMilestones) {
    return v.dod.length
      ? [setup('milestones:absent', 'declare `milestones:` in the STATE.md `release:` block for a release roadmap (optional — the flat definition of done stays valid)')]
      : [];
  }
  const findings = [];
  for (const d of v.dangling) {
    findings.push(setup(`milestones:dangling:${d.criterion}`, `milestone "${d.milestone}" references criterion "${d.criterion}", which is not in \`definition_of_done\` — fix the reference or add the criterion`));
  }
  for (const c of v.unreferenced) {
    findings.push(setup(`milestones:unreferenced:${c}`, `definition_of_done item "${c}" is on no milestone — it renders under "(not yet on the road)"; add it to a milestone to place it on the journey`));
  }
  return findings.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Derive the journey from tracker done-state (spec P1): a milestone is DONE when all its referenced
 * criteria are done; `currentIndex` is the first non-done milestone; `nextIndex` the one after (or
 * -1). File order is the journey order. Unreferenced DoD items are returned so the road can render
 * the trailing "(not yet on the road)" group. `isDone(criterionText)` reports tracker completion.
 * @param {any} release @param {(criterion:string)=>boolean} isDone
 * @returns {{ milestones:{name:string,criteria:string[],done:boolean,mark:string}[], currentIndex:number, nextIndex:number, unreferenced:string[] }}
 */
function deriveJourney(release, isDone) {
  const v = validateMilestones(release);
  const milestones = v.milestones.map((m) => ({
    name: m.name,
    criteria: m.criteria,
    done: m.criteria.length > 0 && m.criteria.every((c) => isDone(c)),
    mark: '',
  }));
  const currentIndex = milestones.findIndex((m) => !m.done);
  for (let i = 0; i < milestones.length; i++) {
    milestones[i].mark = milestones[i].done ? '✓' : (i === currentIndex ? '▶' : '○');
  }
  const nextIndex = currentIndex >= 0 && currentIndex + 1 < milestones.length ? currentIndex + 1 : -1;
  return { milestones, currentIndex, nextIndex, unreferenced: v.unreferenced };
}

/**
 * Draft a `milestones:` YAML block from the existing DoD list (spec P1: `init --update` offers this,
 * human-confirmed) — one milestone per DoD item, criteria referencing that item verbatim. Returns
 * null when there is no DoD to draft from. Deterministic; the caller confirms before applying.
 * @param {any} release @returns {string|null}
 */
function draftMilestones(release) {
  const dod = definitionOfDone(release);
  if (!dod.length) return null;
  const lines = ['milestones:'];
  for (const c of dod) {
    lines.push(`  - name: ${JSON.stringify(c)}`);
    lines.push(`    criteria: [${JSON.stringify(c)}]`);
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  definitionOfDone, parseMilestones, validateMilestones, milestoneFindings, deriveJourney, draftMilestones,
};
