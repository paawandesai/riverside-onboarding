terraform {
  # 1.11+ is needed for write-only arguments and ephemeral resources (secrets never enter state).
  required_version = ">= 1.11"

  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 5.10" }
    random  = { source = "hashicorp/random", version = "~> 3.9" }
    time    = { source = "hashicorp/time", version = "~> 0.13" }
  }

  # Remote state in the existing storage account. Account and resource group come from
  # TF_STATE_ACCOUNT / TF_STATE_RG via -backend-config (see infra/deploy.sh).
  # Key-based access: the service principal can list the account keys but has no blob data role.
  backend "azurerm" {
    container_name = "tfstate"
    key            = "riverside-onboarding.tfstate"
  }
}

provider "azurerm" {
  features {
    key_vault {
      # Demo vault: let `terraform destroy` remove it fully.
      purge_soft_delete_on_destroy = true
    }
  }
  # The deploy identity is scoped to one resource group and cannot register providers.
  # Register them once from the portal or `az provider register` (see infra/README.md).
  resource_provider_registrations = "none"
}
