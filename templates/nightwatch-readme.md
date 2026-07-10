# .nightwatch/ — what to open, when

Each file names its own moment. Read only what supports the morning decision; ignore the machine's memory.

## Read (morning)
- `MORNING.md` — THE file: a byte-identical copy of the newest dated brief. Open this.
- `out/*.patch` — proposed fixes. Only when the brief links one, followed by its full path.

## Edit (daytime — overnight runs never rewrite your content)
- `STATE.md` — your declarations: source-of-truth authority, phase, release definition.
- `config.yaml` — operational knobs: cadences, budgets, caps, ignore globs.
- `RELEASE.md` — release tracker; machine-maintained around your human-owned Notes tail.

## Machine memory (never open)
- `briefs/<date>.md` — dated copies of each brief (committed — they're memory). Never opened.
- `ledger.jsonl` — every finding plus your checkbox verdicts, backfilled automatically. Never opened or edited by hand.
- `state.json` — the machine's scheduling cursor. `STATE.md` is yours; `state.json` is the machine's. Unrelated despite the name.
- `out/*.json` — internal per-run output, gitignored — except `*.patch`, which the brief links by full path. Never browsed.
- `.gitignore` — nested; ignores `out/` without touching your root `.gitignore`. Never opened.
