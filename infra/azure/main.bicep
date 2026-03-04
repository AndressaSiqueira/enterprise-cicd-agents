targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment (e.g., dev, staging, prod)')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

@description('GitHub token for API authentication')
@secure()
param githubToken string = ''

// Tags for all resources
var tags = {
  'azd-env-name': environmentName
  'app-name': 'enterprise-cicd-governance'
}

// Resource group
resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

// Container Apps Environment and API
module containerApps 'modules/container-apps.bicep' = {
  name: 'container-apps'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    githubToken: githubToken
    tags: tags
  }
}

// Outputs
output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output SERVICE_API_URI string = containerApps.outputs.apiUri
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerApps.outputs.registryEndpoint
output AZURE_CONTAINER_REGISTRY_NAME string = containerApps.outputs.registryName
