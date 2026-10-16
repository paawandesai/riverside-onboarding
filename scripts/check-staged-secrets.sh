#!/usr/bin/env bash
# Runs alongside gitleaks. It lists every added line that mentions a secret-like word
# so a human reviews it, and fails only on lines that look like a real value
# (a provider key prefix, a bearer token, or a secret-named key assigned a long literal).
set -euo pipefail
added=$(git diff --cached -U0 -- . ':(exclude)scripts/check-staged-secrets.sh' | grep -E '^\+[^+]' || true)
mentions=$(echo "$added" | grep -iE 'api[_-]?key|secret|token|passw|Bearer |sk-' || true)
if [ -n "$mentions" ]; then
  echo "Review: staged lines mentioning secret-like words:" >&2
  echo "$mentions" >&2
fi
values=$(echo "$added" | grep -E 'sk-ant-[A-Za-z0-9_-]{10,}|Bearer [A-Za-z0-9._-]{20,}|(KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*\s*[:=]\s*["'"'"']?[A-Za-z0-9+/_.=-]{20,}' || true)
# Not values: references to other config (Terraform locals/vars/resources) and kebab-case secret names.
values=$(echo "$values" | grep -vE '[:=]\s*(local|var|data|module|ephemeral|azurerm_[a-z_]+)\.[a-z_.]+\s*[,})]*\s*(:|$)|[:=]\s*"[a-z]+(-[a-z]+)+"\s*,?\s*$' || true)
if [ -n "$values" ]; then
  echo "Blocked: these lines look like real secret values:" >&2
  echo "$values" >&2
  exit 1
fi
