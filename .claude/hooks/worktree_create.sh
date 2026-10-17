#!/usr/bin/env bash
set -Eeuo pipefail

# WorktreeCreate hook. Claude Code invokes this instead of its built-in
# `git worktree` logic, so this script owns both creating the worktree and
# provisioning it through ./scripts/setup.sh.
#
# Claude Code reads the worktree path from stdout and nothing else, so stdout is
# moved to file descriptor 3 and the real stdout is pointed at stderr. Setup
# output stays visible to the user without corrupting the path.

exec 3>&1 1>&2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  printf "\nERROR: %s\n" "$*" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || fail "jq is required by the WorktreeCreate hook."

HOOK_INPUT="$(cat)"

# The event supplies the requested worktree name; the hook chooses the path.
# `worktree_path` is read first only so that a future payload carrying an
# explicit path is honoured instead of being second-guessed.
WORKTREE_NAME="$(printf '%s' "$HOOK_INPUT" | jq -r '.name // empty')"
WORKTREE_PATH="$(printf '%s' "$HOOK_INPUT" | jq -r '.worktree_path // empty')"

git -C "$SCRIPT_DIR" rev-parse --git-dir >/dev/null 2>&1 \
  || fail "The WorktreeCreate hook must run inside a Git repository."

# Resolve the main checkout rather than the current one, so a session already
# inside a worktree still creates new worktrees under the main repository.
GIT_COMMON_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)"
if [ "$(basename "$GIT_COMMON_DIR")" = ".git" ]; then
  REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
else
  REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
fi

if [ -z "$WORKTREE_PATH" ]; then
  [ -n "$WORKTREE_NAME" ] \
    || fail "WorktreeCreate input supplied neither name nor worktree_path."

  case "$WORKTREE_NAME" in
    */* | *..*)
      fail "Refusing a worktree name containing a path separator or '..': $WORKTREE_NAME"
      ;;
  esac

  WORKTREE_PATH="$REPO_ROOT/.claude/worktrees/$WORKTREE_NAME"
fi

# The event carries no base ref, so mirror Claude Code's default of branching
# from the remote default branch and fall back to local HEAD when there is no
# cached origin/HEAD. Nothing is fetched here; run `git fetch` for a newer base.
#
# CRISPR_WORKTREE_BASE_REF overrides the base. The smoke test needs a worktree
# built from the branch under test: without it the test can only ever provision
# from the published default branch, so it grades main's scripts/setup.sh no
# matter what the branch changed. That blind spot is how its .env.local
# assertion stayed red without failing anyone's run.
if [ -n "${CRISPR_WORKTREE_BASE_REF:-}" ]; then
  BASE_REF="$CRISPR_WORKTREE_BASE_REF"
elif git -C "$SCRIPT_DIR" rev-parse --verify --quiet origin/HEAD >/dev/null 2>&1; then
  BASE_REF="origin/HEAD"
else
  BASE_REF="HEAD"
fi

git -C "$SCRIPT_DIR" rev-parse --verify "$BASE_REF^{commit}" >/dev/null 2>&1 \
  || fail "No committed base ref exists. Commit the scaffold before creating a worktree."

BRANCH="claude/$(basename "$WORKTREE_PATH")"
WORKTREE_CREATED=0
BRANCH_CREATED=0
SUCCEEDED=0

# Roll back only what this invocation created. A reused worktree is never
# removed, so a failed setup cannot destroy work already in progress there.
on_exit() {
  if [ "$SUCCEEDED" = "1" ]; then
    return 0
  fi

  if [ "$WORKTREE_CREATED" = "1" ]; then
    printf "Rolling back the worktree created by this hook.\n" >&2
    git -C "$SCRIPT_DIR" worktree remove --force "$WORKTREE_PATH" >/dev/null 2>&1 || true
  fi

  if [ "$BRANCH_CREATED" = "1" ]; then
    git -C "$SCRIPT_DIR" branch -D "$BRANCH" >/dev/null 2>&1 || true
  fi
}
trap on_exit EXIT

if [ -d "$WORKTREE_PATH" ]; then
  EXISTING_ROOT="$(git -C "$WORKTREE_PATH" rev-parse --show-toplevel)"
  EXISTING_COMMON="$(git -C "$WORKTREE_PATH" rev-parse --path-format=absolute --git-common-dir)"
  [ "$EXISTING_ROOT" = "$(cd "$WORKTREE_PATH" && pwd -P)" ] && [ "$EXISTING_COMMON" = "$GIT_COMMON_DIR" ] \
    || fail "Refusing to reuse a directory that is not a worktree of this repository."
  printf "==> Reusing the existing worktree at %s\n" "$WORKTREE_PATH"
else
  printf "==> Creating a worktree at %s from %s\n" "$WORKTREE_PATH" "$BASE_REF"

  # Ownership is recorded before the command that creates the worktree and
  # branch, so a partial failure still rolls both back.
  if git -C "$SCRIPT_DIR" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    WORKTREE_CREATED=1
    git -C "$SCRIPT_DIR" worktree add "$WORKTREE_PATH" "$BRANCH"
  else
    WORKTREE_CREATED=1
    BRANCH_CREATED=1
    git -C "$SCRIPT_DIR" worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_REF"
  fi
fi

[ -f "$WORKTREE_PATH/scripts/setup.sh" ] \
  || fail "scripts/setup.sh is missing from $WORKTREE_PATH."

bash "$WORKTREE_PATH/scripts/setup.sh"

SUCCEEDED=1
printf '%s\n' "$WORKTREE_PATH" >&3
