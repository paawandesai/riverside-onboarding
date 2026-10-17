# Azure deployment

Azure Container Apps (consumption plan) running the single app image, Azure Database for
PostgreSQL Flexible Server (B1ms), Key Vault for every secret, ACR for the image, Log
Analytics for container logs, and an hourly Container Apps job that purges demo data.

## Secrets never pass through Terraform

- Generated secrets (DB admin and app passwords, session secret, email lookup key, field
  encryption key, invite code, demo patient and demo staff passwords) are Terraform **ephemeral** resources passed only to **write-only** arguments
  (`administrator_password_wo`, `value_wo`). They are not in the plan, the state or outputs.
- The Claude API key is written to Key Vault by `set_secret.py` from an environment variable.
- The app reads secrets through Key Vault references resolved with its managed identity.
- The app connects to Postgres as `onboarding_app`, a role that can only read and write rows. An
  init container runs migrations as the admin and creates or updates that role (with a SCRAM
  verifier, so the password never reaches the server in clear text) before each replica starts. The
  admin URL is only passed to that init container, but the app, the init container and the purge
  job share one managed identity that can read every secret in the vault, so code running in the
  app could still fetch it (listed under Known constraints in the main README).
- Key Vault access can be logged (AuditEvent) to the Log Analytics workspace with
  `-var key_vault_audit_logs=true`, once `Microsoft.Insights` is registered on the subscription
  (prerequisite 3). It is off by default because it wasn't registered for the demo.
- No `*.tfvars` file is needed; every variable has a non-secret default.

## One-time prerequisites

1. Resource group `rg-riverside-onboarding` with the deploy service principal holding
   Contributor and Role Based Access Control Administrator on it.
2. A storage account with a `tfstate` container for remote state (`TF_STATE_RG`, `TF_STATE_ACCOUNT`).
   The backend uses the account key, which the principal can list through its RG role.
3. Resource providers registered on the subscription (the RG-scoped principal can't do this):
   `Microsoft.App`, `Microsoft.ContainerRegistry`, `Microsoft.DBforPostgreSQL`,
   `Microsoft.KeyVault`, `Microsoft.OperationalInsights`, `Microsoft.ManagedIdentity`, and
   `Microsoft.Insights` if you turn on Key Vault audit logs.
   For example: `az provider register --namespace Microsoft.App` for each, as a subscription owner.

## Deploy

```
infra/deploy.sh            # review each plan and confirm
infra/deploy.sh -auto-approve
```

The image tag is the current commit, so the working tree must be clean. Without
`ANTHROPIC_RIVERSIDE_API_KEY` the app deploys with the rule-based assistant only.

## Rotating credentials

Raise the default of `credentials_version` in `infra/terraform/variables.tf` by one, commit, and run
`infra/deploy.sh -auto-approve` (the default is kept equal to the live value, 2 today, so a plain
deploy never rotates by accident). That issues new demo patient and staff passwords, invite code, session secret and both DB
passwords. The app sets `CREDENTIALS_VERSION` from it, so the change rolls a new revision that
reads the new values; the init container updates the app role's password and the seed step updates
the demo user's password and signs out its sessions. Existing patient sessions end because the
session secret changes. Expect a short outage during the deploy: once the new revision's init
container changes the app role's password, the old revision can't reach the database until traffic
moves to the new one, and an old-revision replica that restarts in between fails its init container
(the admin password has already changed). Both clear when the new revision is live.

The email lookup key and the field encryption key are not rotated this way: changing them would
make existing accounts unfindable or existing rows unreadable. (Introducing the separate email key
on 2026-10-17 did exactly that once: accounts made before it could no longer sign in, and the purge
removed them; the demo logins were recreated by the seed step.) `FIELD_ENCRYPTION_KEY` accepts a
comma-separated list (new key first) for a planned rotation.

To read the current demo values without printing them anywhere else (you need the Key Vault
Secrets User role on the vault):

```
az keyvault secret show --vault-name <vault> --name demo-user-password --query value -o tsv
az keyvault secret show --vault-name <vault> --name invite-codes --query value -o tsv
az keyvault secret show --vault-name <vault> --name demo-staff-password --query value -o tsv
```

If that returns Forbidden, give yourself read access first (an Owner or RBAC Administrator on the
resource group can run this):

```
az role assignment create --assignee-object-id "$(az ad signed-in-user show --query id -o tsv)" \
  --assignee-principal-type User --role "Key Vault Secrets User" \
  --scope "$(az keyvault show --name <vault> --query id -o tsv)"
```

The staff login (`staff@example.com` by default, `demo_staff_email`) is read-only but sees every
record on the demo. The made-up sample patients are reseeded by the app on start and rebooked by
the hourly purge job (`DEMO_SAMPLE_PATIENTS`).

## After grading

- Rotate the demo login, invite code, session secret and DB passwords (see above).
- Stop keeping an instance warm: `infra/deploy.sh -var min_replicas=0`.
- Or remove everything: `terraform -chdir=infra/terraform destroy`.

## Known limits

- Postgres runs in `centralus` (`db_location`) while the app runs in the resource group's region:
  this subscription had no Flexible Server offers in `eastus`. Each query crosses regions (tens of ms).

- No VNet: Postgres allows connections from Azure services in any tenant (firewall rule
  `0.0.0.0`). Container Apps environments (including consumption-only ones) accept an
  infrastructure subnet and Flexible Server supports a delegated private subnet, so this is a
  choice, not a plan limit: adding them means recreating the environment and the server, which
  wasn't worth it for synthetic data. Mitigations: TLS required and pinned to 1.2+, a row-only app
  role, 40-character random passwords. A production setup would use the VNet and Entra ID
  authentication with password login turned off.
- Key Vault has soft delete (7 days) but not purge protection, so `terraform destroy` can remove
  it completely; a production vault would turn purge protection on (it can't be turned off later).
- The image is deployed by commit tag, not digest, and base images are pinned by tag.
- The `tfstate` container is outside Terraform; turning on blob versioning and soft delete for it
  is a one-off step in the storage account.
- `min_replicas` defaults to 1 during grading: one 1 vCPU / 2 GiB instance stays up, billed at
  Azure's idle rate when not serving, which costs more than scale-to-zero (the free account's credit
  covers it). After grading, `infra/deploy.sh -var min_replicas=0` scales to zero again; the first
  request after idle then pays a cold start (migrations, seed, model check).
