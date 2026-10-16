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

variable "demo_retention_hours" {
  description = "Stored demo data older than this is purged by the scheduled job."
  type        = number
  default     = 24
}

variable "min_replicas" {
  description = "0 scales to zero when idle (cheapest; first request after idle pays a cold start)."
  type        = number
  default     = 0
}

variable "tags" {
  type = map(string)
  default = {
    project = "riverside-onboarding"
    data    = "synthetic-only"
  }
}
