# Generated secrets are ephemeral: Terraform creates them during apply and passes them only to
# write-only arguments (*_wo), so they never appear in the plan, state or outputs.
# Bumping var.credentials_version re-sends new values; the field encryption key has its own
# fixed version because changing it would make existing encrypted rows unreadable.

ephemeral "random_password" "db" {
  length  = 40
  special = false # goes inside a connection URL
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
  db_url_wo         = "postgresql+pg8000://onboarding:${ephemeral.random_password.db.result}@${azurerm_postgresql_flexible_server.db.fqdn}:5432/${azurerm_postgresql_flexible_server_database.app.name}"
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
