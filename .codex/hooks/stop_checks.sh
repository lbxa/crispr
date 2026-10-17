#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec /bin/bash "$repo_root/scripts/agent-hooks/stop-checks.sh"
