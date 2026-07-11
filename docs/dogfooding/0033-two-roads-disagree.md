# Dogfooding finding 0033 — RELEASE.md and the brief rendered two different roads the same night: strict exact-text criterion matching vs judgment fuzzy matching

- **Date:** 2026-07-11
- **Session:** dogfooding against `~/work/product-lab`; first run, milestones declared in
  STATE.md (criteria drafted as paraphrases of the DoD items — by the same session that
  wrote them, which is realistic user behavior).
- **Command:** `/release-progress` (writes RELEASE.md) and `collect-brief.js` (renders
  the brief's "road to release").
- **Classification:** **bug / spec gap** — two renderers of the same declared journey
  disagree because they match criteria differently; plus two smaller fit issues.
- **Status:** specced 2026-07-11 —
  [`release-journey.md`](../specs/release-journey.md) **P4 (accepted 2026-07-11)**: single
  criterion→done matching authority, loud degrade, criteria correct-by-construction,
  parameterized finish line; template regeneration is a direct story.
  [brief-roadmap-composition](../specs/brief-roadmap-composition.md) deliberately **not**
  amended (presentation only). Related: [0021](0021-release-md-milestone-roadmap.md),
  [0018](0018-roadmap-first-brief.md). Triage:
  [0026–0034 record](../specs/DRAFT-findings-0026-0034-triage.md).
- **Priority:** Medium-high.

## Observed behavior

1. **The two roads disagreed.** `.nightwatch/RELEASE.md` marked milestone 1 ("Gateway
   commands implemented per spec") **✓ done** — the judgment layer verified all 10
   commands against spec and said so, fuzzy-matching the paraphrased criteria and
   stating the fuzziness in `degraded` + a setup finding (RP-c923b4). The same night's
   MORNING.md road showed milestone 1 as **"▶ — *you are here*"**: the collector's
   `deriveJourney()` (`scripts/lib/milestones.js:97-110`) marks a milestone done only
   when every criterion passes an **exact-text** `isDone(criterion)` lookup against the
   tracker, and the paraphrases matched nothing. Progress 0.33 in RELEASE.md frontmatter,
   milestone-0-done in the brief — the user's one-file morning view contradicts the
   tracker it summarizes.

2. **The mismatch was born in init.** The release-journey spec requires `criteria` to be
   exact-text references to `definition_of_done` entries, but nothing in the init path
   enforces or generates that (the human/agent drafting STATE.md naturally paraphrases).
   A setup finding fires *after* the first night instead of the declaration being
   correct-by-construction.

3. **Canned shipping language on a non-shipping target.** The brief road hardcodes
   `- 🏁 Tag the release.` (`scripts/collect-brief.js:249`) and "Hygiene gate before
   tagging" — this repo's declared target is operational ("Q&A gateway v1 operational"),
   never tagged. The member job reworded RELEASE.md's finish line; the deterministic
   brief cannot be reworded.

4. **Stale template vs accepted spec.** `templates/RELEASE.md` still carries the
   pre-journey FR63 section order (Release blockers / Remaining — implementation /
   Remaining — documentation) while docs/specs/release-journey.md (accepted 2026-07-11)
   supersedes it with the road-first order; "instantiate from the template" on first run
   contradicts the accepted spec, so the member had to follow the spec against the
   template.

## Why this matters

- The roadmap-first brief (0018/0021 work) makes the road the emotional core of the
  product; the very first thing a new user sees is the brief disagreeing with RELEASE.md
  about where they stand.
- Strict-vs-fuzzy is a fine engineering split (deterministic collector, judgment member)
  — but both ends must consume the *same* resolved matching, or the strict side must
  refuse to render rather than render differently.

## Suggested improvements

1. **Make criteria correct-by-construction:** init (and any flow that drafts
   `milestones:`) copies DoD text verbatim into `criteria`; validation runs at
   write time, not first-night.
2. **Single matching authority:** have release-progress persist the resolved
   criterion→done mapping into its findings JSON/tracker, and have `deriveJourney`
   consume that instead of re-matching raw text — the collector stays deterministic (it
   reads recorded facts) and the two roads cannot diverge.
3. **When matching fails, degrade loudly in the road itself** — "milestone state
   unavailable: criteria don't match DoD (see RP-c923b4)" beats rendering a wrong ▶.
4. **Parameterize the finish line** off the declared target (e.g. "🏁 Declare *<target>*
   done."), keeping "Tag the release" only when a tag/version check is actually enabled.
5. **Regenerate `templates/RELEASE.md`** to the accepted release-journey order.
