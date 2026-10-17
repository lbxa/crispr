#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
command -v bun >/dev/null || { printf 'Bun 1.3.14 or newer is required.\n' >&2; exit 1; }
bun install --frozen-lockfile
bun run --filter '@crispr/observability' build
bun run --filter '@crispr/browser-harness' build
bun run --filter '@crispr/human-model' build
printf 'Workspace ready. Run bun run dev, or bun run verify:browser for the browser loop.\n'
