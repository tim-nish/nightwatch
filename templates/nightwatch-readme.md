# .nightwatch/ — what to open, when

Each file names its own moment, and answers four questions so you never guess which files are yours and which are the machine's: **edit?** · **owner** · **safe to delete?** · **committed?** Read only what supports the morning decision; ignore the machine's memory.

## Read (morning)
| file | edit? | owner | safe to delete? | committed? |
|------|-------|-------|-----------------|------------|
| `MORNING.md` | no | machine | yes — rewritten next run | no |
| `runtime/out/*.patch` | no | machine | yes — regenerated while the finding is open | no |

## Edit (daytime — overnight runs never rewrite your content)
| file | edit? | owner | safe to delete? | committed? |
|------|-------|-------|-----------------|------------|
| `STATE.md` | yes | you | no — your declarations | yes |
| `config.yaml` | yes | you | no — your knobs | yes |
| `RELEASE.md` | yes — the Notes tail | shared | no | yes |

## Machine memory (never open)
| file | edit? | owner | safe to delete? | committed? |
|------|-------|-------|-----------------|------------|
| `briefs/<date>.md` | no | machine | no — memory | yes |
| `ledger.jsonl` | no | machine | **no — deleting it destroys memory** | yes |
| `README.md` | no | machine | yes — `init` recreates it | yes |
| `.gitignore` | no | machine | yes — `init` recreates it | yes |
| `runtime/` | no | machine | **yes — deleting it only resets cadence** | no |
| `runtime/cursors.json` | no | machine | yes — part of `runtime/` | no |
| `runtime/out/*.json` | no | machine | yes — part of `runtime/` | no |

## Two deletion subtleties
- Everything under `runtime/` is disposable — safe to delete; deleting it only resets cadence and forgets tonight's idempotency, and the next run re-creates it.
- `ledger.jsonl` is Nightwatch's memory (feedback, recurrence, demotion) — deleting it is not safe, and it lives *outside* `runtime/` for exactly that reason.

`STATE.md` is yours; `runtime/cursors.json` is the machine's scheduling cursor — unrelated despite the old name (the cursor was `state.json` before it moved under `runtime/`).
