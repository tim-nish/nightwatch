# Dogfooding finding 0024 — Runtime files are indistinguishable from user files; two of the reader's four questions have no answer anywhere

- **Date:** 2026-07-11
- **Session:** dogfooding — *writing-assistant*, `.nightwatch/` directory as encountered
  (same round as 0018–0023).
- **Command:** none — the subject is the output directory's layout, its documentation,
  and one silent misconfiguration the ambiguity already produced.
- **Classification:** output usability / information architecture. Escalation of
  [0017](0017-output-file-descriptions.md): 0017 fixed *descriptions* and deliberately
  deferred *structure*; this finding requests the structural redesign and shows the
  description-only remedy both failed to arrive and doesn't cover the questions asked.
- **Status:** documented; verbatim user feedback with review analysis and forensics.

## The feedback (user's own framing)

> `.nightwatch/` currently mixes user-facing files (MORNING.md, STATE.md) with internal
> runtime files (state.json) in the same directory. I couldn't tell whether state.json
> was important state or disposable output. Please redesign the directory layout and
> documentation so it's immediately obvious: what users should edit, what Nightwatch
> owns, what is safe to delete, what should be committed.

## Review analysis

**1. The shipped remedy never reached the install.** Story 8.5 (merged 2026-07-11)
ships exactly the disarming description this feedback asks for — the
`.nightwatch/README.md` orientation file with the three-tier map and the
`state.json`/`STATE.md` "unrelated despite the name" line. But it is written only by
`init`, and this install predates it; nothing nudges an existing install to re-run
`init --update` and receive it. Verified: the writing-assistant `.nightwatch/` has no
`README.md`. Same delivery-gap pattern as 0019: the fix exists in the product and is
silent at the point of encounter.

**2. Two of the four questions have no answer in ANY doc, arrived or not.** The 0017
taxonomy answers *when to open* (read / edit / never open) — which covers "what should I
edit" and "what does Nightwatch own." But:

- **"What is safe to delete?"** — zero coverage. Grep across the orientation template and
  the plugin README: no delete/disposability language anywhere. And the answer is
  genuinely non-obvious (see table below): `state.json` deletion silently re-arms the
  first-run confirmation gate (FR40) and resets every cadence cursor.
- **"What should be committed?"** — one sentence in the plugin repo's README ("Commit the
  briefs and the ledger — they are the system's memory"), which the host-repo user may
  never read, and which nothing enforces.

**3. The commit-policy gap already caused real, silent damage.** Forensics on the
install: the host repo's root `.gitignore` line 31 reads `.nightwatch/*` — the **entire
directory is ignored**. `git ls-files .nightwatch/` returns nothing: the ledger and the
dated briefs — the memory the demotion rule, recurrence counting, and feedback loop
depend on surviving — are not version-controlled and vanish on any fresh clone.
Nightwatch never detected or objected to this, although the check is one deterministic
`git check-ignore` away. The user's "what should be committed?" is not hypothetical
confusion; the ambiguity has already inverted the design's intent, undetected.

**4. `state.json` confusion has now recurred — 0017's revisit trigger has fired.** 0017
deferred the rename ("revisit only if the collision still confuses users after this spec
ships"), betting on descriptions. The nuance: the description never arrived here (point
1), so the bet is technically unsettled — but the user is no longer asking for better
descriptions; they are asking for **structure**, and a directory boundary is
self-documenting in a way prose never is.

## The four questions, answered per file (the table the layout should make unnecessary)

| File | Edit? | Owner | Safe to delete? | Commit? |
|---|---|---|---|---|
| `MORNING.md` | mark checkboxes | machine | yes — regenerated copy of the newest brief | yes (convention) |
| `STATE.md` | **yes** | human | **no** — your declarations | yes |
| `config.yaml` | **yes** | human | no — your knobs (defaults would apply) | yes |
| `RELEASE.md` | Notes section | machine + human tail | **no** — tracker items + your notes | yes |
| `briefs/` | no | machine (memory) | **no** — feedback/recurrence history | **yes — but ignored in this install** |
| `ledger.jsonl` | no | machine (memory) | **no** — the system's entire memory | **yes — but ignored in this install** |
| `state.json` | no | machine (runtime) | yes, with side effects: cadence cursors reset, first-run gate re-arms | yes (convention) |
| `out/` | no | machine (runtime) | yes — disposable by design | no (gitignored) |
| `README.md`, `.gitignore` | no | machine | yes — `init` recreates | yes |

Three distinct kinds hide in one flat directory: **human-edited declarations**
(STATE.md, config.yaml, RELEASE.md's tail), **committed machine memory** (briefs,
ledger), and **disposable runtime** (out/, state.json). The kinds have opposite answers
to "delete?" and "commit?", and nothing but prose separates them.

## What this suggests (observations, not yet design)

- **Structure by kind, not prose by file**: e.g. disposable runtime under one
  subdirectory (`.nightwatch/runtime/` holding `state.json` + `out/`, gitignored as a
  unit — "everything in here is safe to delete") and machine memory under another
  (`.nightwatch/memory/` for `briefs/` + `ledger.jsonl` — "committed, never edited").
  Each boundary answers all four questions at once. Cost: a file-layout-v2 migration
  with the same legacy-fallback + `init`-confirmed-move discipline as 0008; the
  `state.json` rename (0017's deferred `cursors.json`) rides along free.
- **Enforce the commit policy deterministically**: a `git check-ignore` probe on the
  ledger path at run start → one `setup` finding when memory files are ignored ("your
  `.gitignore` ignores `.nightwatch/ledger.jsonl` — Nightwatch's memory will not survive
  a clone"). Cheap, script-layer, catches the damage found above.
- **Close the delivery gap for existing installs**: a config-drift-style one-line nudge
  when the orientation README is absent, pointing at `init --update` — so layout fixes
  reach installs that predate them.
- The orientation README gains the **four-column table** above (edit / owner / delete /
  commit), superseding the three-tier when-to-open map as its core content.

## Next step

Spec candidate: `docs/specs/runtime-layout.md` (file-layout v2 — structure by kind,
commit-policy probe, delivery nudge, `state.json` relocation/rename), triaged with the
0018–0023 round. Immediate independent fix for the writing-assistant install regardless
of triage: replace `.gitignore:31`'s `.nightwatch/*` with `.nightwatch/out/` so the
ledger and briefs start being committed.
