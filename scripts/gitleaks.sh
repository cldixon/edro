#!/usr/bin/env bash
# Runs gitleaks with the repo config, or with .gitleaks.local.toml when present
# (a personal, uncommitted config that adds blocked hostnames; see CONTRIBUTING.md).
#
#   scripts/gitleaks.sh staged    scan staged changes (pre-commit hook)
#   scripts/gitleaks.sh history   scan every commit (CI)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed, so this commit can't be checked for secrets." >&2
  echo "Install it (https://github.com/gitleaks/gitleaks#installing), e.g. 'brew install gitleaks'." >&2
  exit 1
fi

config=.gitleaks.toml
[[ -f .gitleaks.local.toml ]] && config=.gitleaks.local.toml

case "${1:-}" in
  staged) exec gitleaks git --staged --redact --no-banner --config "$config" ;;
  history) exec gitleaks git --redact --no-banner --verbose --config "$config" ;;
  *) echo "usage: $0 staged|history" >&2; exit 2 ;;
esac
