# Example Terraform configuration for staging
# This file exists to demonstrate IaC change detection

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "location" {
  type    = string
  default = "eastus"
}

resource "azurerm_resource_group" "main" {
  name     = "rg-enterprise-app-${var.environment}"
  location = var.location

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "azurerm_service_plan" "main" {
  name                = "asp-enterprise-app-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "P1v2"
}

output "resource_group_id" {
  value = azurerm_resource_group.main.id
}

output "service_plan_id" {
  value = azurerm_service_plan.main.id
}
