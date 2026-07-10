# Dogfooding finding 0017 — How the output files should be described: the layout presents nine files with equal weight, when the morning reader needs exactly one and a half

- **Date:** 2026-07-10
- **Session:** dogfooding — companion to [0016](0016-morning-brief-usability.md). 0016 recorded
  that `MORNING.md` alone fails the tired-morning test; this finding reviews **the rest of the
  output surface** (`RELEASE.md`, `STATE.md`, `config.yaml`, `briefs/`, `ledger.jsonl`,
  `state.json`, `out/`) from the same seat, and — unlike 0016 — **proposes answers**: how each
  file should be described so it stops competing for morning attention.
- **Command:** none — the subject is the file layout of `.nightwatch/` in the host repo
  (*writing-assistant*) and its description in the README ("What lands in your repo" table).
- **Classification:** output usability / documentation. Every file's content is correct per
  spec; the failure is that the layout and its descriptions give a low-energy reader no way to
  know which files to ignore.
- **Status:** review with proposals. **Update 2026-07-10:** folded into
  [`docs/specs/output-file-taxonomy.md`](../specs/output-file-taxonomy.md) (descriptions, tiers,
  `RELEASE.md` inversion, orientation README) and
  [`docs/specs/brief-composition.md`](../specs/brief-composition.md) (the brief itself). The
  `state.json` rename stays deferred, as recommended below. No code changes implemented.

## The core observation

The README describes the layout as a flat list of nine entries with equal typographic weight.
Read from the morning seat, those nine files split into **three audiences that the layout never
distinguishes**:

1. **Read in the morning** (low energy, decision-support): `MORNING.md` — and, this run, one
   patch file the brief points at.
2. **Edit in the daytime** (deliberate, occasional): `STATE.md`, `config.yaml`, the human-owned
   tail of `RELEASE.md`.
3. **Machine memory** (never open): `briefs/`, `ledger.jsonl`, `state.json`, `out/*.json`,
   `.gitignore`.

Because nothing in the layout, the filenames, or the descriptions encodes this split, the tired
reader — who by design opens this directory every morning — has to re-derive it each time, or
(what actually happened) opens the wrong files, finds them "terrible to support my decision,"
and pays the concentration cost the product exists to protect.

## Per-file review, from the morning seat

### `MORNING.md`
Covered by 0016. For this finding, only its **role** matters: it is the sole tier-1 file, and
every other file's description should be written relative to it ("you don't need this; the
brief will point here if you do").

### `RELEASE.md` — the right content, upside down
The most instructive failure. As read this morning:

- **Its best block is buried.** "Next actions (top 3)" — a scannable, prioritized,
  do-this-next list, *exactly* the entry point 0016 asked for — is the 10th of 11 sections,
  below "Nice to have." The single most decision-supporting block on the whole surface is at
  the bottom of the second file.
- **It opens machine-face-first.** YAML frontmatter, then a status paragraph that is
  **duplicated verbatim** in `MORNING.md`'s Release-progress section — the reader who opens
  both (as the brief invites) reads the same paragraph twice.
- **History precedes decisions.** Six "Done" bullets with inline evidence paths come before
  "Remaining." Done items are audit trail, not morning decision support.
- **Finding IDs lead the bullets.** `RP-70609d — Add CI configuration` forces the reader to
  parse a hex code before reaching the three words that matter. IDs are cross-reference
  plumbing; they belong at the end of a line (as `MORNING.md`'s checkboxes already do), or in
  the JSON.

RELEASE.md is currently described as "maintained by /release-progress" — a producer-side
description. It should be described (and eventually composed) reader-side: *"the running
answer to 'how far from release, and what's left' — next actions at the top, evidence below,
your notes at the bottom, machine-maintained around them."*

### `STATE.md` — correct file, self-absorbed prose
A daytime contract file, and fine as one. But 17 of its 33 lines are the file explaining
Nightwatch's mechanics to the reader before the 15-line YAML block of actual declarations. If
opened in the morning (and nothing says not to), it costs a full read to learn it contains
nothing for today. Its description should set the expectation explicitly: **write-once-ish,
daytime, "you will rarely reopen this; overnight runs never change it."**

### `config.yaml` — good daytime file, undifferentiated placement
The comments are genuinely the manual — this is the best-documented file on the surface. The
only problem is placement in the flat list next to `MORNING.md` with equal weight. Description
should say: **daytime knobs; nothing in here ever changes overnight or needs morning review.**

### `briefs/` — confirmed byte-identical duplicate
`briefs/2026-07-10.md` and `MORNING.md` are identical to the byte (verified with `diff`). 0016
said the duplication "reads as redundancy"; it *is* redundancy, by design — but the design
rationale ("dated briefs are memory, committed") lives only in the README table, not at the
point of encounter. The description must state the mechanism, not just the purpose:
**"`MORNING.md` is a copy of the newest file in `briefs/`; open `MORNING.md`, commit
`briefs/`, never read both."** Without the word *copy*, every new user re-diffs them to find
out (this one did).

### `ledger.jsonl` — description currently overpromises
README: "every finding ever, with acted-on/dismissed marks." That reads like an invitation —
as if checking your marks means opening it. In reality the user's touch-point is the checkbox
in `MORNING.md`, and the ledger is append-only machine memory that the backfill writes *for*
them. Describe it as internal: **"machine memory of every finding and your checkbox verdicts;
committed, never opened or edited by hand."**

### `state.json` — internal, and named into a collision
Cadence cursors; correctly internal. But it sits in the same directory as `STATE.md` — two
files named "state" with **opposite** audiences (one is the most human file on the surface,
the other the most internal). No description fully repairs a naming collision, but the
descriptions should at least be written back-to-back to disarm it: *"`STATE.md` — yours;
`state.json` — the machine's scheduling cursor. Unrelated despite the name."* (A rename —
`cursors.json` / `schedule.json` — belongs on the redesign spec's list.)

### `out/` — described as noise, but contains tonight's only action
The layout calls `out/` "transient per-run JSON + patch files (gitignore this)". Yet the one
concrete action this brief produced — apply `reconcile-2026-07-10.patch` — requires entering
`out/`. The user is simultaneously told *this directory is machine exhaust, ignore it* and
*your next action is inside it*. Either patches deserve their own described location (e.g.
`patches/`, tier-1-adjacent), or the description must split the directory's two roles:
**"internal run output — except `*.patch` files, which are proposals the brief will link you
to directly."** The brief linking the *full path* of the patch (it already does) is what makes
the second option workable.

### `.gitignore`
Present in the directory, absent from the layout table. One line in the table ("machine-managed,
keeps `out/` out of git") ends its career as a mystery.

## Proposed description: the table, rewritten

Replace the flat list in "What lands in your repo" with a three-tier table, ordered by
audience, each line answering "when do I open this?":

```text
.nightwatch/
  # Morning — read (the brief is the only entry point; it links to anything else you need)
  MORNING.md          # THE file. Open this, act on checkboxes; ignore everything below
  out/*.patch         # proposed fixes — only when MORNING.md links one

  # Daytime — edit (never touched by overnight runs / human sections preserved)
  STATE.md            # your declarations: authority, phase, definition of done
  config.yaml         # knobs: cadence, budgets, caps, ignore globs
  RELEASE.md          # release tracker; machine-maintained, your Notes section preserved

  # Machine memory — never open (committed so the system remembers; not for reading)
  briefs/<date>.md    # dated copies of each morning's brief (MORNING.md = newest one)
  ledger.jsonl        # every finding + your checkbox verdicts, backfilled automatically
  state.json          # cadence cursors (the machine's "state" — unrelated to STATE.md)
  out/*.json          # raw per-run output (gitignored)
  .gitignore          # machine-managed, keeps out/ untracked
```

Two rules the rewrite follows, worth keeping for any future file:

1. **Every description names its moment** (morning / daytime / never), not its producer.
   "Maintained by /release-progress" tells the reader who writes it; "open when planning, not
   at 7am" tells them what to do.
2. **Internal files are described as internal in absolute terms** ("never open"), because a
   hedged description ("with acted-on/dismissed marks") is read as an invitation at exactly
   the moment attention is scarcest.

## Beyond descriptions (recorded for the redesign spec, not fixed here)

- **De-duplicate the verbatim status paragraph** between `MORNING.md` and `RELEASE.md` — the
  brief should carry the one-line progress + a link, not the full paragraph twice.
- **Invert `RELEASE.md`**: Next actions → Remaining → Blockers/Decisions → Done → evidence.
  Frontmatter and IDs to the ends of lines.
- **Resolve the `STATE.md` / `state.json` name collision** (rename the JSON).
- **Give patches a first-class home or a first-class description** — the "gitignore this"
  directory cannot be where next actions live without at least a split description.
- **Consider an in-directory README** (or header comments in the machine files): the layout
  explanation currently lives only in the Nightwatch repo's README, which the host-repo user
  encountering `.nightwatch/` may never have open.

## Why this matters

0016 established that the brief's composition doesn't convert to action. This finding adds:
**the surrounding files actively tax the same attention budget.** The reader who bounces off
`MORNING.md` naturally tries the neighboring files for help; every one of them either
duplicates what was already read (`briefs/`, the status paragraph in `RELEASE.md`), explains
itself at length before saying anything (`STATE.md`), or is internal plumbing indistinguishable
from content (`ledger.jsonl`, `state.json`, `out/`). The layout's flat, producer-side
descriptions turn eight supporting files into eight small withdrawals from the one account the
product promises to protect.

## Next step

Fold the three-tier taxonomy and per-file descriptions above into the README's "What lands in
your repo" section and `docs/` as part of the documentation pass 0016 already called for, and
carry the "Beyond descriptions" items into the brief-redesign spec when it is scoped.
