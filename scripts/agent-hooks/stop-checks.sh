#!/usr/bin/env bash
set -euo pipefail

hook_input="$(cat)"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
log_dir="$repo_root/.harness/verification"
mkdir -p "$log_dir"
log_file="$(mktemp "$log_dir/stop.XXXXXX")"

# The Python backend is checked only where its environment exists: Cloudflare's
# deploy build runs `bun run verify` and has no Python.
run_checks() {
  bun run verify || return 1
  if [ -x "$repo_root/backend/.venv/bin/python" ]; then
    bun run verify:backend
  fi
}

if run_checks >"$log_file" 2>&1; then
  printf '{}\n'
  exit 0
fi

cat "$log_file" >&2
printf '\nVerification log: %s\n' "$log_file" >&2
# Both clients supply this boolean. Parse JSON rather than matching message text.
if printf '%s' "$hook_input" | bun -e 'const data = await Bun.stdin.json(); process.exit(data.stop_hook_active === true ? 0 : 1)' 2>/dev/null; then
  printf '{"systemMessage":"Deterministic verification is still failing. Report the unresolved failures and .harness/verification log; do not claim completion."}\n'
else
  printf '{"decision":"block","reason":"Verification (bun run verify, plus verify:backend when backend/.venv exists) failed. Inspect .harness/verification, fix the failures, and rerun verification before handoff."}\n'
fi
