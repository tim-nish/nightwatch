# Project state — declarations for Nightwatch (and for humans)

This file is a contract. It records the few things **no tool can infer** about this
repository, so Nightwatch never has to guess and silently corrupt your truth. Everything
outside the single fenced `yaml` block below is prose for humans and is ignored by tooling.
Edit it by hand (or re-run `/nightwatch init`); overnight runs never touch this file.

Fill in only what applies. Anything you omit is treated as *undeclared*: the dependent
check is skipped and surfaced as a one-line setup finding — never inferred.

- **authority** — which artifact is the source of truth per area. `role: authoritative`
  means code and docs must conform to it (a conflict is a human decision). `role: derived`
  means it must follow the code (a conflict is mechanically fixable — patch proposed).
- **phase** — changes ranking: `prototype`/`building` weight overengineering up;
  `hardening`/`released` weight drift and coupling up.
- **release** — the target and the human definition of "done".

```yaml
authority:
  architecture: {artifact: "docs/ARCHITECTURE.md", role: authoritative}
  behavior:     {artifact: "specs/*.md", role: authoritative, rule: newest-accepted-wins}
  usage:        {artifact: "README.md", role: derived}   # follows code, never leads it
phase: prototype            # prototype | building | hardening | released
release:
  target: "v0.1 public release"
  definition_of_done:
    - "quickstart reproduces on a fresh clone in 15 minutes"
    - "all commands have specs and the reconciler reports 0 drift"
  milestones:                          # optional: the ordered release journey (file order = road order)
    - name: "Commands specified & drift-free"
      criteria: ["all commands have specs and the reconciler reports 0 drift"]
    - name: "Quickstart proven on a fresh clone"
      criteria: ["quickstart reproduces on a fresh clone in 15 minutes"]
```
