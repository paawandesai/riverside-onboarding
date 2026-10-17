data "azurerm_client_config" "current" {}

data "azurerm_resource_group" "rg" {
  name = var.resource_group_name
}

locals {
  location = coalesce(var.location, data.azurerm_resource_group.rg.location)
  rg       = data.azurerm_resource_group.rg.name
  suffix   = random_string.suffix.result
}

# Globally unique names for ACR, Key Vault and Postgres. Not a secret.
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_log_analytics_workspace" "logs" {
  name                = "log-${var.name}-${local.suffix}"
  location            = local.location
  resource_group_name = local.rg
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = 1
  tags                = var.tags
}

resource "azurerm_container_registry" "acr" {
  name                = "acr${var.name}${local.suffix}"
  location            = local.location
  resource_group_name = local.rg
  sku                 = "Basic"
  admin_enabled       = false # pulls use the app's managed identity
  tags                = var.tags
}

resource "azurerm_key_vault" "kv" {
  name                       = "kv-${var.name}-${local.suffix}"
  location                   = local.location
  resource_group_name        = local.rg
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = false
  soft_delete_retention_days = 7
  tags                       = var.tags
}

# Identity the app and purge job run as: pull images, read secrets. Nothing else.
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.name}-app"
  location            = local.location
  resource_group_name = local.rg
  tags                = var.tags
}

resource "azurerm_role_assignment" "app_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "app_kv_read" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}

# The deploy identity writes generated secrets and pushes images.
resource "azurerm_role_assignment" "deployer_kv_write" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "deployer_acr_push" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPush"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Role assignments take a short while to reach the Key Vault data plane.
resource "time_sleep" "rbac_propagation" {
  depends_on      = [azurerm_role_assignment.deployer_kv_write, azurerm_role_assignment.app_kv_read]
  create_duration = "60s"
}

resource "azurerm_postgresql_flexible_server" "db" {
  name                = "psql-${var.name}-${local.suffix}"
  location            = var.db_location
  resource_group_name = local.rg
  version             = "16"
  sku_name            = "B_Standard_B1ms" # burstable; covered by the Azure free account's monthly hours
  storage_mb          = 32768
  storage_tier        = "P4"

  backup_retention_days        = 7
  geo_redundant_backup_enabled = false

  administrator_login = "onboarding"
  # Write-only: sent to Azure on create/rotation, never stored in Terraform state.
  administrator_password_wo         = ephemeral.random_password.db.result
  administrator_password_wo_version = var.credentials_version

  public_network_access_enabled = true
  tags                          = var.tags

  lifecycle {
    ignore_changes = [zone] # Azure picks a zone on create
  }
}

# Container Apps on the consumption plan have no fixed egress IP without a VNet, so this
# allows connections from Azure services. TLS and the password still apply. See README.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.db.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = "onboarding"
  server_id = azurerm_postgresql_flexible_server.db.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_container_app_environment" "env" {
  name                       = "cae-${var.name}"
  location                   = local.location
  resource_group_name        = local.rg
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs.id
  tags                       = var.tags
}
