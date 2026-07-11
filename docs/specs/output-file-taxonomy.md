# Spec: Output-file taxonomy — every file names its moment (read / edit / never open)

- **Status:** accepted 2026-07-10 — **folded into `nightwatch.md`** §2.4 (host layout), §5
  (`RELEASE.md` reader-side order, item format), §6 (`init` writes the orientation README),
  §7 (templates). README/docs rewrites land at implementation. **FR assignment deferred** to
  the BMAD planning-artifacts update (not yet generated).
- **Superseded in part 2026-07-11:** P3's section order is replaced by
  [release-journey](release-journey.md) P3 (journey order — the road first); the
  orientation README's three-tier content (P5-adjacent, shipped as FR65) is replaced by
  [runtime-layout](runtime-layout.md) P5's four-column map; and P6's deferred
  `state.json` rename is now exercised (`runtime/cursors.json`, runtime-layout P1). The
  taxonomy vocabulary, description rules (P1–P2), and patch-exception description (P4)
  remain in force.
- **Motivated by:** dogfooding finding
  [0017 — Output file descriptions](../dogfooding/0017-output-file-descriptions.md)
  (with [0016](../dogfooding/0016-morning-brief-usability.md) as context).
- **Refines:** [file-layout](file-layout.md) (0008) fixed *where* artifacts live; this spec
  fixes *how they present themselves to a reader* — descriptions, tiering, and the one
  file whose internal order works against the reader (`RELEASE.md`). All file-layout
  invariants (locations, single home, back-compat reads, migration rules) are untouched.
- **Design input:** the information-architecture proposal in 0017 (three-tier table), plus
  the validated prototype [`docs/prototypes/MORNING-2026-07-10.md`](../prototypes/MORNING-2026-07-10.md)
  for the patch-discoverability path.
- **Scope:** descriptions and user-facing documentation of the `.nightwatch/` surface; the
  section order and id placement inside `RELEASE.md`; one new machine-written orientation
  file. No file moves, no renames, no change to what is committed vs. gitignored.

## Problem

The nine files under `.nightwatch/` split into three audiences — read in the morning, edit in
the daytime, machine memory — but the layout, filenames, and every current description
present them flat and producer-side ("maintained by /release-progress"). Observed costs
(0017, all from one real morning): `briefs/<date>.md` is a byte-identical duplicate of
`MORNING.md` that a new user diffs to understand; `ledger.jsonl`'s description reads as an
invitation to open it; `state.json` collides with `STATE.md` in name while being its opposite
in audience; and the night's one actionable artifact (the reconcile patch) lives in `out/`,
the directory documented as "transient … gitignore this." Each mis-description is a small
withdrawal from the attention budget the product exists to protect.

## Design constraints (invariants this spec must not break)

1. **file-layout invariants hold.** No location changes, no root artifacts, migration and
   fallback-read rules exactly as accepted.
2. **Round-trip safety.** `RELEASE.md` remains parse → merge → serialize byte-stable for
   human-owned content; sections are identified by heading name, so reordering is a writer
   concern, not a reader concern.
3. **Single-writer contract.** `RELEASE.md` is still written only through the tracking
   store; the new orientation README is written only by `init`.
4. **Descriptions must survive being read at 7am.** Hedged descriptions of internal files
   are treated as bugs (a hedge is an invitation).

## The taxonomy (normative vocabulary)

Three tiers, used by *every* user-facing description of the layout — plugin README, install
docs, `init` output, the orientation README, and `nightwatch.md` §2.4:

| Tier | Meaning | Files |
|---|---|---|
| **Read (morning)** | Opened at low energy; must convert to action | `MORNING.md`; `out/*.patch` only via the brief's direct link |
| **Edit (daytime)** | Deliberate, occasional; overnight runs never rewrite your content | `STATE.md`, `config.yaml`, `RELEASE.md` (machine-maintained around a human-owned Notes tail) |
| **Machine memory (never open)** | Committed or transient state the system keeps for itself | `briefs/`, `ledger.jsonl`, `state.json`, `out/*.json`, `.gitignore` |

## Proposals

### P1 — Two description rules

1. **Name the moment, not the producer.** Every description answers "when do I open this?"
   — "open when planning, not at 7am" — instead of which job writes it.
2. **Internal files are internal in absolute terms.** "Never open" / "never edited by hand",
   not "contains X you might want." Specifically: `ledger.jsonl` is described as *"machine
   memory of every finding and your checkbox verdicts, backfilled automatically — never
   opened or edited by hand"*, replacing the current mark-listing description.

### P2 — `MORNING.md` is described as a copy

Everywhere the pair appears: *"`MORNING.md` is a byte-identical copy of the newest file in
`briefs/`; open `MORNING.md`, commit `briefs/`, never read both."* The mechanism (copy), not
just the purpose (memory), is what stops the reader diffing them. No behavior change — the
copy semantics are already what `collect-brief.js` implements.

### P3 — `RELEASE.md` inverted for the reader

The markdown backend serializes sections in reader-side order — what to do first, history
last:

```
Next actions (top 3) → Release blockers → Human decisions needed →
Remaining — implementation → Remaining — documentation → Nice to have →
Done → Status update (latest first, capped) → Phase → Notes (human-owned, last)
```

- **Item format:** ids trail the line — `- [ ] <title> (evidence: path:line) · RP-014` —
  so the reader meets the action before the code.
- Sections are parsed by heading name (constraint 2): files in the old order read fine and
  are re-serialized in the new order on the next run; the Notes section stays last and
  byte-preserved. Frontmatter is unchanged (machine fields stay machine-parseable).
- Content of every section is unchanged — this is ordering and id placement only.

### P4 — Patches are the described exception in `out/`

`out/` is described with its split role stated: *"internal per-run output (gitignored) —
except `*.patch` files, which are proposals the brief links by full path when one is ready."*
The brief always links a patch by its full repo-relative path (the prototype and 0015's
apply-command presentation already do this), so the reader never browses `out/` — they follow
a link into it. No file moves; discoverability is carried by the link plus the honest
description.

### P5 — `.nightwatch/README.md`: the layout explains itself

`init` instantiates a ~15-line `README.md` inside `.nightwatch/` from a shipped template
(`templates/nightwatch-readme.md`): the three-tier table above, one line per file, nothing
else. Rationale: the only current home of the layout explanation is the *plugin repo's*
README, which the host-repo user may never have open; the point of encounter is the
directory itself. Machine-owned (recreated by `init` if deleted), committed, and the one
"machine" file that exists to be read — once, on first encounter.

### P6 — `state.json` / `STATE.md`: disarmed by description, rename deferred

The two are always described back-to-back: *"`STATE.md` — yours; `state.json` — the
machine's scheduling cursor. Unrelated despite the name."* A rename (`cursors.json`) is
**deliberately out of scope** — it buys little once descriptions and the orientation README
land, and costs a migration path; revisit only if the collision still confuses users after
this spec ships.

## Non-goals

- No file moves or renames (including `state.json`), no change to commit-vs-ignore rules.
- No symlinking or pointer-file replacement of the `MORNING.md`/`briefs/` copy pair.
- No content changes to `RELEASE.md` sections, the tracker interface, frontmatter, or the
  single-writer rule — P3 is ordering and id placement only.
- No change to where patches are written (`out/` stays their home).

## Acceptance criteria

1. Every user-facing layout description (plugin README, install docs, `init` summary,
   `.nightwatch/README.md`, `nightwatch.md` §2.4) presents the files in the three tiers with
   moment-naming descriptions; `ledger.jsonl`, `state.json`, `out/*.json`, and `briefs/` are
   described as never-open, and `MORNING.md` as a byte-identical copy of the newest brief.
2. A fresh `init` writes `.nightwatch/README.md` from the template; deleting it and
   re-running `init` recreates it; overnight runs never write it.
3. `release-progress` serializes `RELEASE.md` in the P3 section order with trailing ids; a
   pre-existing file in the old order is read correctly, re-serialized in the new order on
   the next run, and its Notes section plus human-authored item text survive byte-identical.
4. `out/` is described with the patch exception everywhere it appears, and every
   patch announcement links the full repo-relative patch path (0015's presentation).
5. `state.json` and `STATE.md` are described back-to-back with the disarming line in the
   orientation README and the plugin README.

## Tests

- **tracker round-trip:** old-order fixture → parse → serialize → new order, Notes and
  human item text byte-preserved; new-order fixture → idempotent re-serialize.
- **item format:** trailing-id lines parse to the same items as leading-id lines (legacy
  read); writer emits trailing ids only.
- **init:** fresh run writes `.nightwatch/README.md` matching the template; existing file
  untouched by overnight runs; deleted file recreated on next `init`.
- **docs assertions:** the plugin README's layout block contains the three tier headings and
  the copy-wording for `MORNING.md` (guarding against description drift — cheap grep tests,
  same spirit as the reconcile self-check).
