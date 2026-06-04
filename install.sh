#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${X_CLAUDE_TIPS_REPO_URL:-https://github.com/mshegolev/x-claude-tips.git}"
REF="${X_CLAUDE_TIPS_REF:-main}"
TARGET_DIR="${X_CLAUDE_TIPS_TARGET_DIR:-$HOME/.claude/skills/x-claude-tips}"
SOURCE_DIR="${X_CLAUDE_TIPS_SOURCE_DIR:-}"
DRY_RUN="${X_CLAUDE_TIPS_DRY_RUN:-}"
BROWSER="${X_CLAUDE_TIPS_BROWSER:-firefox}"
CREDS_FILE="${X_CREDS_FILE:-$HOME/.x-creds}"

case "$BROWSER" in
  chrome|firefox|safari|auto) ;;
  *)
    echo "install.sh: invalid X_CLAUDE_TIPS_BROWSER '$BROWSER'" >&2
    echo "install.sh: choose from chrome, firefox, safari, auto" >&2
    exit 1
    ;;
esac
export X_CLAUDE_TIPS_BROWSER="$BROWSER"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "install.sh: required command not found: $1" >&2
    exit 1
  fi
}

tmp_dir=""
cleanup() {
  if [ -n "$tmp_dir" ] && [ -d "$tmp_dir" ]; then
    rm -rf "$tmp_dir"
  fi
}
trap cleanup EXIT

need_cmd node

if [ -z "$SOURCE_DIR" ]; then
  need_cmd git
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/x-claude-tips-install.XXXXXX")"
  echo "install.sh: cloning $REPO_URL#$REF"
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$tmp_dir"
  SOURCE_DIR="$tmp_dir"
fi

args=(--source "$SOURCE_DIR" --target "$TARGET_DIR")
if [ "$DRY_RUN" = "1" ] || [ "$DRY_RUN" = "true" ]; then
  args+=(--dry-run)
fi

node "$SOURCE_DIR/update.js" "${args[@]}"

if [ -z "$DRY_RUN" ]; then
  echo "install.sh: installed x-claude-tips into $TARGET_DIR"
  echo "install.sh: default browser for refresh_creds: $BROWSER"
  echo "install.sh: override per-run with --browser, or re-install with"
  echo "             X_CLAUDE_TIPS_BROWSER=<chrome|firefox|safari|auto>"

  # Persist the choice into an existing ~/.x-creds (bash-exported each
  # session). New creds files already ship the default via the template.
  if [ -f "$CREDS_FILE" ]; then
    if grep -q '^export X_CLAUDE_TIPS_BROWSER=' "$CREDS_FILE"; then
      tmp_creds="$(mktemp "${TMPDIR:-/tmp}/x-creds.XXXXXX")"
      sed "s|^export X_CLAUDE_TIPS_BROWSER=.*|export X_CLAUDE_TIPS_BROWSER=$BROWSER|" \
        "$CREDS_FILE" >"$tmp_creds"
      cat "$tmp_creds" >"$CREDS_FILE"
      rm -f "$tmp_creds"
    else
      printf 'export X_CLAUDE_TIPS_BROWSER=%s\n' "$BROWSER" >>"$CREDS_FILE"
    fi
    chmod 600 "$CREDS_FILE"
    echo "install.sh: recorded default browser in $CREDS_FILE"
  fi
fi
