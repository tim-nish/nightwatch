#!/usr/bin/env bash
set -euo pipefail

# When nested mount targets (e.g. ~/.claude/commands, ~/.claude/tools,
# ~/.claude/.credentials.json) are used, Docker creates the missing parent
# ~/.claude as root before mounting into it — leaving vscode unable to write
# there (Claude Code needs to write session state and refreshed tokens).
# Fix ownership of the parent only. Do NOT use `chown -R`: commands and tools
# are read-only bind mounts from the host, and recursing into them would fail
# or clobber host-side ownership.
sudo chown vscode:vscode /home/vscode/.claude
mkdir -p /home/vscode/.claude/session-env

# Fail loudly, at container-creation time, if a required host dependency is
# missing — this template depends on the `dotfiles` and `claude-config` repos
# by contract (mounts only; it never vendors their content). A missing
# dependency must never degrade silently into a half-configured container.

err() { echo "post-create: ERROR: $*" >&2; }

bootstrap="$HOME/dotfiles/devcontainer/bootstrap.sh"
claude_commands="$HOME/.claude/commands"
claude_tools="$HOME/.claude/tools"
missing=0

if [ ! -f "$bootstrap" ]; then
  err "dotfiles bootstrap not found at ~/dotfiles/devcontainer/bootstrap.sh"
  err "  -> Check out the 'dotfiles' repo and mount it at ~/dotfiles."
  missing=1
fi

if [ ! -d "$claude_commands" ]; then
  err "claude-config commands not found at ~/.claude/commands"
  err "  -> Check out 'claude-config' and mount ~/.claude/commands (read-only)."
  missing=1
elif [ -z "$(ls -A "$claude_commands" 2>/dev/null || true)" ]; then
  err "claude-config commands directory ~/.claude/commands is empty"
  err "  -> Ensure the 'claude-config' checkout is populated before mounting."
  missing=1
fi

if [ ! -d "$claude_tools" ]; then
  err "claude-config tools not found at ~/.claude/tools"
  err "  -> Check out 'claude-config' and mount ~/.claude/tools (read-only)."
  missing=1
elif [ -z "$(ls -A "$claude_tools" 2>/dev/null || true)" ]; then
  err "claude-config tools directory ~/.claude/tools is empty"
  err "  -> Ensure the 'claude-config' checkout provides shared tools before mounting."
  missing=1
fi

if [ "$missing" -ne 0 ]; then
  err "Aborting: required host dependencies are missing (see above)."
  exit 1
fi

echo "post-create: host dependencies present; running dotfiles bootstrap..."
bash "$bootstrap"
