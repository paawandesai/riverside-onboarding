# No variable here carries a secret. Generated secrets are ephemeral (secrets.tf) and the
# Claude API key is written to Key Vault by infra/set_secret.py, outside Terraform.

variable "resource_group_name" {
  description = "Existing resource group the deploy identity is scoped to."
  type        = string
  default     = "rg-riverside-onboarding"
}

variable "location" {
  description = "Azure region. Defaults to the resource group's region."
  type        = string
  default     = null
}

variable "db_location" {
  description = "Region for Postgres. Free and trial subscriptions are often blocked from Flexible Server in busy regions (eastus returned no offers), so it can differ from the app's region."
  type        = string
  default     = "centralus"
}

variable "name" {
  description = "Short name used as a prefix for resources."
  type        = string
  default     = "onboarding"
}

variable "image_tag" {
  description = "Tag of the app image in ACR. Leave null on the first apply; the app and purge job are created once an image exists."
  type        = string
  default     = null
}

variable "anthropic_key_in_vault" {
  description = "Set true after infra/set_secret.py has stored the Claude API key. False runs the assistant in rule-based fallback mode."
  type        = bool
  default     = false
}

variable "anthropic_model" {
  description = "Model id (configuration, not code). The app checks it against the Models API at startup and fails fast if unavailable."
  type        = string
  default     = "claude-haiku-5-5"
}

variable "credentials_version" {
  description = "Bump to rotate the DB password, session secret, invite code and demo password (e.g. after grading)."
  type        = number
  default     = 1
}

variable "demo_user_email" {
  description = "Login for the user-role demo account. The password is generated into Key Vault."
  type        = string
  default     = "demo@example.com"
}

variable "demo_staff_email" {
  description = "Login for the read-only staff demo account. The password is generated into Key Vault."
  type        = string
  default     = "staff@example.com"
}

variable "demo_retention_hours" {
  description = "Stored demo data older than this is purged by the scheduled job."
  type        = number
  default     = 24
}

variable "min_replicas" {
  description = "1 keeps one instance warm so graders never wait on a cold start. Set 0 after grading to scale to zero when idle (cheapest)."
  type        = number
  default     = 1
}

variable "tags" {
  type = map(string)
  default = {
    project = "riverside-onboarding"
    data    = "synthetic-only"
  }
}

variable "key_vault_audit_logs" {
  description = "Send Key Vault AuditEvent logs to Log Analytics. Register Microsoft.Insights on the subscription first."
  type        = bool
  default     = false
}
