#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILLS_DIR="$CLAUDE_DIR/skills"
COMMANDS_DIR="$CLAUDE_DIR/commands"
SETTINGS="$CLAUDE_DIR/settings.json"

info() { printf '  %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1" >&2; }

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    warn "node is not on PATH. bita needs Node 24 or newer."
    exit 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt 24 ]; then
    warn "node $major found; bita needs 24 or newer for node:sqlite and type stripping."
    exit 1
  fi
  info "node $(node -v)"
}

link() {
  local target="$1" linkname="$2"
  if [ -L "$linkname" ]; then
    if [ "$(readlink "$linkname")" = "$target" ]; then
      info "already linked: $linkname"
      return
    fi
    rm "$linkname"
  elif [ -e "$linkname" ]; then
    mv "$linkname" "$linkname.backup"
    warn "moved the existing $linkname to $linkname.backup"
  fi
  ln -s "$target" "$linkname"
  info "linked: $linkname"
}

echo "bita — installing the Claude Code integration"
echo
require_node

echo
echo "Skill"
mkdir -p "$SKILLS_DIR"
link "$REPO_ROOT/skill" "$SKILLS_DIR/bita"

echo
echo "Slash commands"
mkdir -p "$COMMANDS_DIR"
for file in "$REPO_ROOT"/commands/*.md; do
  link "$file" "$COMMANDS_DIR/$(basename "$file")"
done

echo
echo "Binary"
BIN_DIR=""
if [ -n "${BITA_BIN_DIR:-}" ]; then
  BIN_DIR="$BITA_BIN_DIR"
elif [ -n "${PNPM_HOME:-}" ] && [ -d "$PNPM_HOME/bin" ]; then
  BIN_DIR="$PNPM_HOME/bin"
elif command -v pnpm >/dev/null 2>&1 && pnpm bin -g >/dev/null 2>&1; then
  BIN_DIR="$(pnpm bin -g 2>/dev/null | tail -1)"
elif [ -d "$HOME/.local/bin" ]; then
  BIN_DIR="$HOME/.local/bin"
fi

chmod +x "$REPO_ROOT/src/bin/bita.ts"

if [ -n "$BIN_DIR" ] && [ -d "$BIN_DIR" ]; then
  link "$REPO_ROOT/src/bin/bita.ts" "$BIN_DIR/bita"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) warn "$BIN_DIR is not on PATH; add it to your shell profile" ;;
  esac
else
  warn "found no bin directory to link into."
  warn "set BITA_BIN_DIR to one on your PATH and re-run, or link it yourself:"
  warn "  ln -s $REPO_ROOT/src/bin/bita.ts <dir-on-path>/bita"
fi

echo
echo "Settings"
if [ ! -f "$SETTINGS" ]; then
  warn "no $SETTINGS yet; create it and re-run, or copy the block below by hand"
fi
node "$REPO_ROOT/scripts/merge-settings.mjs" "$SETTINGS"

echo
echo "Done. Open a new session, then:"
echo "  bita project add \"<name>\"     create a project"
echo "  bita scope set . <projectId>  map this repository to it"
echo
echo "Once a repository is mapped, the SessionStart hook tells Claude to offer"
echo "the timer when work that leaves an artifact begins."
