# Generated secrets are ephemeral: Terraform creates them during apply and passes them only to
# write-only arguments (*_wo), so they never appear in the plan, state or outputs.
# Bumping var.credentials_version re-sends new values and, through the CREDENTIALS_VERSION env var
# in app.tf, rolls a new app revision that reads them. The field encryption key and the email
# lookup key have their own fixed versions: changing them would make existing rows unreadable or
# existing accounts unfindable.

ephemeral "random_password" "db" {
  length  = 40
  special = false # goes inside a connection URL
}

# The app's own least-privilege login (rows only); the admin password above is used only by the
# migration init container.
ephemeral "random_password" "db_app" {
  length  = 40
  special = false
}

ephemeral "random_password" "email_hmac" {
  length  = 64
  special = false
}

ephemeral "random_password" "session" {
  length  = 64
  special = false
}

ephemeral "random_password" "invite" {
  length  = 20
  special = false
}

ephemeral "random_password" "demo_user" {
  length  = 24
  special = false
}

ephemeral "random_bytes" "field_key" {
  length = 32
}

locals {
  field_key_version = 1
  email_key_version = 1
  db_host           = "${azurerm_postgresql_flexible_server.db.fqdn}:5432/${azurerm_postgresql_flexible_server_database.app.name}"
  db_admin_url_wo   = "postgresql+pg8000://onboarding:${ephemeral.random_password.db.result}@${local.db_host}"
  db_url_wo         = "postgresql+pg8000://${local.app_db_role}:${ephemeral.random_password.db_app.result}@${local.db_host}"
  app_db_role       = "onboarding_app"
  # Fernet keys are URL-safe base64 of 32 random bytes.
  field_key_wo = replace(replace(ephemeral.random_bytes.field_key.base64, "+", "-"), "/", "_")
}

resource "azurerm_key_vault_secret" "database_url" {
  name             = "database-url"
  key_vault_id     = azurerm_key_vault.kv.id
  value_wo         = local.db_url_wo
  value_wo_version = var.credentials_version
  depends_on       = [time_sleep.rbac_propagation]
}

resource "azurerm_key_vault_secret" "migration_database_url" {
  name             = "migration-database-url"
  key_vault_id     = azurerm_key_vault.kv.id
  value_wo         = local.db_admin_url_wo
  value_wo_version = var.credentials_version
  depends_on       = [time_sleep.rbac_propagation]
}

resource "azurerm_key_vault_secret" "email_hmac_key" {
  name             = "email-hmac-key"
  key_vault_id     = azurerm_key_vault.kv.id
  value_wo         = ephemeral.random_password.email_hmac.result
  value_wo_version = local.email_key_version
  depends_on       = [time_sleep.rbac_propagation]
}

resource "azurerm_key_vault_secret" "session_secret" {
  name             = "session-secret"
  key_vault_id     = azurerm_key_vault.kv.id
  value_wo         = ephemeral.random_password.session.result
  value_wo_version = var.credentials_version
  depends_on       = [time_sleep.rbac_propagation]
}

resource "azurerm_key_vault_secret" "invite_codes" {
  name             = "invite-codes"
  key_vault_id     = azurerm_key_vault.kv.id
  value_wo         = ephemeral.random_password.invite.result
  value_wo_version = var.credentials_version
  depends_on       = [time_sleep.rbac_propagation]
}

resource "azurerm_key_vault_secret" "demo_user_password" {
  name             = "demo-user-password"
  key_vault_id     = azurerm_key_vault.kv.id
  value_wo         = ephemeral.random_password.demo_user.result
  value_wo_version = var.credentials_version
  depends_on       = [time_sleep.rbac_propagation]
}

resource "azurerm_key_vault_secret" "field_encryption_key" {
  name             = "field-encryption-key"
  key_vault_id     = azurerm_key_vault.kv.id
  value_wo         = local.field_key_wo
  value_wo_version = local.field_key_version
  depends_on       = [time_sleep.rbac_propagation]
}
