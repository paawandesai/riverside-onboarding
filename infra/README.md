# Azure deployment

Azure Container Apps (consumption plan) running the single app image, Azure Database for
PostgreSQL Flexible Server (B1ms), Key Vault for every secret, ACR for the image, Log
Analytics for container logs, and an hourly Container Apps job that purges demo data.

## Secrets never pass through Terraform

- Generated secrets (DB password, session secret, field encryption key, invite code, demo
  password) are Terraform **ephemeral** resources passed only to **write-only** arguments
  (`administrator_password_wo`, `value_wo`). They are not in the plan, the state or outputs.
- The Claude API key is written to Key Vault by `set_secret.py` from an environment variable.
- The app reads secrets through Key Vault references resolved with its managed identity.
- No `*.tfvars` file is needed; every variable has a non-secret default.

## One-time prerequisites

1. Resource group `rg-riverside-onboarding` with the deploy service principal holding
   Contributor and Role Based Access Control Administrator on it.
2. A storage account with a `tfstate` container for remote state (`TF_STATE_RG`, `TF_STATE_ACCOUNT`).
   The backend uses the account key, which the principal can list through its RG role.
3. Resource providers registered on the subscription (the RG-scoped principal can't do this):
   `Microsoft.App`, `Microsoft.ContainerRegistry`, `Microsoft.DBforPostgreSQL`,
   `Microsoft.KeyVault`, `Microsoft.OperationalInsights`, `Microsoft.ManagedIdentity`.
   For example: `az provider register --namespace Microsoft.App` for each, as a subscription owner.

## Deploy

```
infra/deploy.sh            # review each plan and confirm
infra/deploy.sh -auto-approve
```

The image tag is the current commit, so the working tree must be clean. Without
`ANTHROPIC_RIVERSIDE_API_KEY` the app deploys with the rule-based assistant only.

## After grading

- Rotate the demo login, invite code, session secret and DB password:
  `infra/deploy.sh -var credentials_version=2`.
- Or remove everything: `terraform -chdir=infra/terraform destroy`.

## Known limits

- Postgres runs in `centralus` (`db_location`) while the app runs in the resource group's region:
  this subscription had no Flexible Server offers in `eastus`. Each query crosses regions (tens of ms).

- No VNet: Postgres allows connections from Azure services (firewall rule `0.0.0.0`), protected
  by TLS and a generated password. A production setup would use VNet integration and a
  private endpoint, which the free account's consumption plan doesn't include.
- `min_replicas = 0` keeps cost near zero; the first request after idle pays a cold start
  (migrations, seed, model check). Set `-var min_replicas=1` for steady latency.
