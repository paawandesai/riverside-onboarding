#!/usr/bin/env bash
# Runs alongside gitleaks. It lists every added line that mentions a secret-like word (values
# masked) so a human reviews it, and fails only on lines that look like a real value: a provider
# key prefix, a bearer token, a connection string or URL with a password, or a secret-named key
# assigned a long literal (any case, in env, JSON, YAML or HCL style).
set -euo pipefail
# "file<TAB>+line" for each added line, so a finding can be located; only the line part is masked.
added=$(git diff --cached -U0 -- . ':(exclude)scripts/check-staged-secrets.sh' |
  awk '/^\+\+\+ b\//{f=substr($0,7)} /^\+[^+]/{print f "\t" $0}' || true)
mask() { sed -E "s/([:=@][[:space:]]*[\"']?)[^\"'[:space:],}@]{4,}/\1***/g"; }
mentions=$(echo "$added" | grep -iE 'api[_-]?key|secret|token|passw|bearer |sk-|accountkey' || true)
if [ -n "$mentions" ]; then
  echo "Review: staged lines mentioning secret-like words (values masked):" >&2
  echo "$mentions" | mask >&2
fi
values=$(echo "$added" | grep -iE 'sk-ant-[A-Za-z0-9_-]{10,}|Bearer [A-Za-z0-9._-]{20,}|AccountKey=[A-Za-z0-9+/=]{20,}|[a-z][a-z0-9+.-]*://[^/[:space:]:@]+:[^@[:space:]]{8,}@|["'"'"']?[A-Za-z_]*(key|secret|token|password)[A-Za-z_]*["'"'"']?\s*[:=]\s*["'"'"']?[A-Za-z0-9+/_.=-]{20,}' || true)
# Not values: references to other config (Terraform locals/vars/resources, process.env), kebab-case
# secret names, and the change-me placeholders in .env.example.
values=$(echo "$values" | grep -vE '[:=]\s*(local|var|data|module|ephemeral|azurerm_[a-z_]+)\.[a-z_.]+\s*[,})]*\s*(:|$)|[:=]\s*process\.env\.[A-Z0-9_]+\s*,?\s*$|[:=]\s*"[a-z]+(-[a-z]+)+"\s*,?\s*$|change-me' || true)
if [ -n "$values" ]; then
  echo "Blocked: these lines look like real secret values (masked):" >&2
  echo "$values" | mask >&2
  exit 1
fi
