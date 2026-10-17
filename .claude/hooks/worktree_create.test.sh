#!/usr/bin/env bash
set -euo pipefail
# Real Git worktrees in an isolated fixture; no network, copied secrets, or HEAD required.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/crispr-worktree-test.XXXXXX")"
fixture="$(cd "$fixture" && pwd -P)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/.claude/hooks" "$fixture/scripts"
cp "$repo_root/.claude/hooks/worktree_create.sh" "$fixture/.claude/hooks/"
cp "$repo_root/scripts/agent-hooks/fixtures/setup.sh" "$fixture/scripts/setup.sh"
git -C "$fixture" init -q
git -C "$fixture" add .
git -C "$fixture" -c user.name=Test -c user.email=test@example.invalid -c commit.gpgsign=false commit -qm fixture
export CRISPR_WORKTREE_BASE_REF=HEAD
hook="$fixture/.claude/hooks/worktree_create.sh"
target="$fixture/.claude/worktrees/test"
created="$(printf '{"name":"test"}' | bash "$hook" 2>"$fixture/output.log")"
[ "$created" = "$target" ]
[ -f "$target/.setup-complete" ]
reused="$(printf '{"name":"test"}' | bash "$hook" 2>>"$fixture/output.log")"
[ "$reused" = "$target" ]
explicit="$fixture/explicit"
[ "$(printf '{"worktree_path":"%s"}' "$explicit" | bash "$hook" 2>>"$fixture/output.log")" = "$explicit" ]
if printf '{"name":"../escape"}' | bash "$hook" >/dev/null 2>&1; then
  printf 'Unsafe worktree name was accepted\n' >&2; exit 1
fi
if printf '{}' | bash "$hook" >/dev/null 2>&1; then
  printf 'Missing worktree name was accepted\n' >&2; exit 1
fi
mkdir -p "$fixture/.claude/worktrees/unrelated"
if printf '{"name":"unrelated"}' | bash "$hook" >/dev/null 2>&1; then
  printf 'Unrelated directory was reused\n' >&2; exit 1
fi
if printf '{"name":"failed"}' | FAIL_SETUP=1 bash "$hook" >/dev/null 2>&1; then
  printf 'Setup failure was hidden\n' >&2; exit 1
fi
[ ! -d "$fixture/.claude/worktrees/failed" ]
if git -C "$fixture" show-ref --verify --quiet refs/heads/claude/failed; then
  printf 'Failed setup left its branch behind\n' >&2; exit 1
fi
if printf '{"name":"test"}' | FAIL_SETUP=1 bash "$hook" >/dev/null 2>&1; then
  printf 'Repeated setup failure was hidden\n' >&2; exit 1
fi
[ -f "$target/.setup-complete" ]
printf 'Worktree hook: create, reuse, explicit path, validation, and rollback passed.\n'
