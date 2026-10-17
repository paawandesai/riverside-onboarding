#!/usr/bin/env bash
# Build, push and deploy the demo to Azure Container Apps.
#
# Needs in the environment (never in files or arguments):
#   ARM_CLIENT_ID ARM_CLIENT_SECRET ARM_TENANT_ID ARM_SUBSCRIPTION_ID   deploy service principal
#   TF_STATE_RG TF_STATE_ACCOUNT                                        remote state location
#   ANTHROPIC_RIVERSIDE_API_KEY (optional)  without it the assistant runs in rule-based fallback mode
#   PROXY_CA (optional)                     CA file for builds behind a TLS-intercepting proxy
#
# Extra arguments go to `terraform apply` (for example -auto-approve or -var credentials_version=2).
set -euo pipefail

for v in ARM_CLIENT_ID ARM_CLIENT_SECRET ARM_TENANT_ID ARM_SUBSCRIPTION_ID TF_STATE_RG TF_STATE_ACCOUNT; do
  [ -n "${!v:-}" ] || { echo "missing env var: $v" >&2; exit 1; }
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF="terraform -chdir=$ROOT/infra/terraform"
TAG="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
[ -z "$(git -C "$ROOT" status --porcelain)" ] || { echo "commit your changes first; the image tag is the commit" >&2; exit 1; }

$TF init -input=false -reconfigure \
  -backend-config="resource_group_name=$TF_STATE_RG" \
  -backend-config="storage_account_name=$TF_STATE_ACCOUNT"

echo "== 1/4 registry, vault and generated secrets"
$TF apply -input=false "$@" \
  -target=azurerm_role_assignment.deployer_acr_push \
  -target=azurerm_key_vault_secret.database_url \
  -target=azurerm_key_vault_secret.migration_database_url \
  -target=azurerm_key_vault_secret.session_secret \
  -target=azurerm_key_vault_secret.email_hmac_key \
  -target=azurerm_key_vault_secret.field_encryption_key \
  -target=azurerm_key_vault_secret.invite_codes \
  -target=azurerm_key_vault_secret.demo_user_password

ACR="$($TF output -raw acr_login_server)"
VAULT="$($TF output -raw key_vault_name)"

echo "== 2/4 build and push $ACR/onboarding:$TAG"
build_args=()
[ -n "${PROXY_CA:-}" ] && build_args+=(--secret "id=proxy_ca,src=$PROXY_CA")
docker build "${build_args[@]}" -t "$ACR/onboarding:$TAG" "$ROOT"
printf '%s' "$ARM_CLIENT_SECRET" | docker login "$ACR" --username "$ARM_CLIENT_ID" --password-stdin
docker push "$ACR/onboarding:$TAG"
docker logout "$ACR" >/dev/null # don't leave the service principal secret in ~/.docker/config.json

echo "== 3/4 Claude API key"
ANTHROPIC_IN_VAULT=false
if [ -n "${ANTHROPIC_RIVERSIDE_API_KEY:-}" ]; then
  python3 "$ROOT/infra/set_secret.py" --vault "$VAULT" --name anthropic-api-key --from-env ANTHROPIC_RIVERSIDE_API_KEY
  ANTHROPIC_IN_VAULT=true
else
  echo "ANTHROPIC_RIVERSIDE_API_KEY not set: deploying with the rule-based assistant only"
fi

echo "== 4/4 app and purge job"
$TF apply -input=false "$@" -var "image_tag=$TAG" -var "anthropic_key_in_vault=$ANTHROPIC_IN_VAULT"
echo "app: $($TF output -raw app_url)"
echo "demo login: $($TF output -raw demo_user_email); password and invite code are in Key Vault $VAULT (demo-user-password, invite-codes)"
