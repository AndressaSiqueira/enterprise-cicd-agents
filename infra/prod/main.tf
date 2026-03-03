# Production Terraform configuration
# WARNING: Changes to this file will trigger apply_infra intent
# which is DENIED by default policy

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
  
  backend "azurerm" {
    # Production state should be in a secure backend
    resource_group_name  = "rg-terraform-state"
    storage_account_name = "stterraformstate"
    container_name       = "tfstate"
    key                  = "prod.terraform.tfstate"
  }
}

provider "azurerm" {
  features {}
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "location" {
  type    = string
  default = "eastus"
}

# Production-specific variables
variable "prod_sku" {
  type    = string
  default = "P2v3"
  description = "Production SKU - higher tier for production workloads"
}

resource "azurerm_resource_group" "main" {
  name     = "rg-enterprise-app-${var.environment}"
  location = var.location

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Critical    = "true"
  }
}

resource "azurerm_service_plan" "main" {
  name                = "asp-enterprise-app-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = var.prod_sku
  
  # Production requires zone redundancy
  zone_balancing_enabled = true
}

output "resource_group_id" {
  value     = azurerm_resource_group.main.id
  sensitive = false
}

output "service_plan_id" {
  value     = azurerm_service_plan.main.id
  sensitive = false
}
