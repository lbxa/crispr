#!/usr/bin/env bash
set -euo pipefail
# Browser sessions own and close their app process trees. Keep evidence for diagnosis.
printf 'No shared processes to clean up. Browser sessions clean up on close or EOF.\n'
