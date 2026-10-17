# Names and URLs only. No output carries a secret value.

output "app_url" {
  value = local.deploy_app ? local.app_origin : null
}

output "acr_login_server" {
  value = azurerm_container_registry.acr.login_server
}

output "key_vault_name" {
  value = azurerm_key_vault.kv.name
}

output "demo_user_email" {
  value = var.demo_user_email
}

output "demo_staff_email" {
  value = var.demo_staff_email
}
