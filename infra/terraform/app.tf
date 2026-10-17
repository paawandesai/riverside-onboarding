locals {
  deploy_app = var.image_tag != null
  image      = "${azurerm_container_registry.acr.login_server}/onboarding:${coalesce(var.image_tag, "none")}"
  app_name   = "ca-${var.name}"
  app_origin = "https://${local.app_name}.${azurerm_container_app_environment.env.default_domain}"

  # Container App secret name => Key Vault reference, resolved with the app identity; values never pass through Terraform.
  # The Claude key is optional and stored outside Terraform (infra/set_secret.py).
  vault_secrets = {
    for s in [
      azurerm_key_vault_secret.database_url,
      azurerm_key_vault_secret.migration_database_url,
      azurerm_key_vault_secret.session_secret,
      azurerm_key_vault_secret.email_hmac_key,
      azurerm_key_vault_secret.field_encryption_key,
      azurerm_key_vault_secret.invite_codes,
      azurerm_key_vault_secret.demo_user_password,
      azurerm_key_vault_secret.demo_staff_password,
    ] : s.name => s.versionless_id
  }
  anthropic_secret_name = "anthropic-api-key"
  kv_secrets = merge(
    local.vault_secrets,
    var.anthropic_key_in_vault ? { (local.anthropic_secret_name) = "${azurerm_key_vault.kv.vault_uri}secrets/${local.anthropic_secret_name}" } : {}
  )

  # Env var => Container App secret name.
  job_secret_env = {
    DATABASE_URL         = azurerm_key_vault_secret.database_url.name
    SESSION_SECRET       = azurerm_key_vault_secret.session_secret.name
    FIELD_ENCRYPTION_KEY = azurerm_key_vault_secret.field_encryption_key.name
    EMAIL_HMAC_KEY       = azurerm_key_vault_secret.email_hmac_key.name
  }
  # The migration init container connects as the admin and sets up the app's row-only role.
  migrate_secret_env = merge(local.job_secret_env, {
    DATABASE_URL     = azurerm_key_vault_secret.migration_database_url.name
    APP_DATABASE_URL = azurerm_key_vault_secret.database_url.name
  })
  secret_env = merge(
    local.job_secret_env,
    {
      INVITE_CODES        = azurerm_key_vault_secret.invite_codes.name
      DEMO_USER_PASSWORD  = azurerm_key_vault_secret.demo_user_password.name
      DEMO_STAFF_PASSWORD = azurerm_key_vault_secret.demo_staff_password.name
    },
    var.anthropic_key_in_vault ? { ANTHROPIC_API_KEY = local.anthropic_secret_name } : {}
  )

  plain_env = {
    APP_ENV = "production"
    # Key Vault references are versionless and read when a revision starts, so a rotation only takes
    # effect in a new revision; changing this value is what creates one.
    CREDENTIALS_VERSION       = tostring(var.credentials_version)
    RUN_MIGRATIONS            = "false"
    FORWARDED_IP_HOPS         = "1"
    CLINIC_TIMEZONE           = "America/New_York"
    DEMO_MODE                 = "true"
    DEMO_RETENTION_HOURS      = tostring(var.demo_retention_hours)
    DEMO_USER_EMAIL           = var.demo_user_email
    DEMO_STAFF_EMAIL          = var.demo_staff_email
    DEMO_SAMPLE_PATIENTS      = "true"
    DATABASE_SSL              = "true"
    CORS_ORIGINS              = local.app_origin
    ANTHROPIC_MODEL           = var.anthropic_model
    ANTHROPIC_EFFORT          = "low"
    ANTHROPIC_TIMEOUT_SECONDS = "6"
  }
}

resource "azurerm_container_app" "app" {
  count                        = local.deploy_app ? 1 : 0
  name                         = local.app_name
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = local.rg
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  dynamic "secret" {
    for_each = local.kv_secrets
    content {
      name                = secret.key
      key_vault_secret_id = secret.value
      identity            = azurerm_user_assigned_identity.app.id
    }
  }

  ingress {
    external_enabled           = true
    target_port                = 8000
    allow_insecure_connections = false
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = 2

    # Runs before every replica starts: migrations and the app role, as the database admin.
    init_container {
      name    = "migrate"
      image   = local.image
      cpu     = 0.25
      memory  = "0.5Gi"
      command = ["sh", "-c", "alembic upgrade head && python -m scripts.ensure_app_role"]

      dynamic "env" {
        for_each = { for k, v in local.plain_env : k => v if startswith(k, "APP_") || startswith(k, "DATABASE_") || startswith(k, "CREDENTIALS_") }
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.migrate_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }

    container {
      name   = "app"
      image  = local.image
      cpu    = 1
      memory = "2Gi"

      dynamic "env" {
        for_each = local.plain_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 8000
        path                    = "/api/health"
        initial_delay           = 5
        interval_seconds        = 5
        failure_count_threshold = 30
      }
      liveness_probe {
        transport        = "HTTP"
        port             = 8000
        path             = "/api/health"
        interval_seconds = 30
      }
    }
  }

  depends_on = [azurerm_role_assignment.app_acr_pull, time_sleep.rbac_propagation]
}

# Scheduled purge of demo data older than var.demo_retention_hours. Runs hourly.
resource "azurerm_container_app_job" "purge" {
  count                        = local.deploy_app ? 1 : 0
  name                         = "job-${var.name}-purge"
  location                     = local.location
  resource_group_name          = local.rg
  container_app_environment_id = azurerm_container_app_environment.env.id
  replica_timeout_in_seconds   = 300
  replica_retry_limit          = 1
  tags                         = var.tags

  schedule_trigger_config {
    cron_expression = "17 * * * *"
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  dynamic "secret" {
    for_each = { for k, v in local.vault_secrets : k => v if contains(values(local.job_secret_env), k) }
    content {
      name                = secret.key
      key_vault_secret_id = secret.value
      identity            = azurerm_user_assigned_identity.app.id
    }
  }

  template {
    container {
      name    = "purge"
      image   = local.image
      cpu     = 0.5
      memory  = "1Gi"
      command = ["python", "-m", "scripts.purge_demo_data"]

      dynamic "env" {
        for_each = { for k, v in local.plain_env : k => v if startswith(k, "APP_") || startswith(k, "DEMO_") || startswith(k, "DATABASE_") || startswith(k, "CREDENTIALS_") || startswith(k, "CLINIC_") }
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.job_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  depends_on = [azurerm_role_assignment.app_acr_pull, time_sleep.rbac_propagation]
}
