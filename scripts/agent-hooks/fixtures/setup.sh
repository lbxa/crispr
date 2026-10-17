#!/usr/bin/env bash
set -euo pipefail
[ "${FAIL_SETUP:-0}" != 1 ] || exit 1
cd "$(dirname "${BASH_SOURCE[0]}")/.."
touch .setup-complete
printf 'Fixture provisioned\n'
