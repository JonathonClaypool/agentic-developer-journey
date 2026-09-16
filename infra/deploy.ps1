[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$AksResourceGroupName,

    [Parameter(Mandatory)]
    [string]$AksClusterName,

    [Parameter(Mandatory)]
    [string]$AcrResourceGroupName,

    [Parameter(Mandatory)]
    [string]$AcrName,

    [string]$PortalResourceGroupName = "rg-ai-launchpad-app",
    [string]$StorageResourceGroupName = "",
    [string]$StorageAccountName = "",
    [string]$ArtifactContainerName = "launchpad-deployment-artifacts",
    [string]$KubernetesNamespace = "ai-launchpad",
    [string]$BackendServiceAccountName = "launchpad-backend",
    [string]$BackendIdentityName = "id-ai-launchpad-backend",
    [string]$BackendEnvironmentFile = "backend\.env",
    [string]$ImageTag = "",
    [switch]$EnableAzureDeployments
)

$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
$repositoryRoot = Split-Path -Parent $PSScriptRoot

function Read-DotEnv {
    param([string]$Path)

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        $pair = $trimmed -split "=", 2
        if ($pair.Count -eq 2) {
            $values[$pair[0].Trim()] = $pair[1].Trim().Trim('"').Trim("'")
        }
    }
    return $values
}

function Get-RequiredValue {
    param(
        [hashtable]$Values,
        [string]$Name
    )

    $value = $Values[$Name]
    if (-not $value) {
        throw "Required setting $Name is missing from the backend environment file."
    }
    return $value
}

function Invoke-Native {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

function New-TrackedBuildContext {
    param([string]$Root)

    $context = Join-Path ([System.IO.Path]::GetTempPath()) "ai-launchpad-build-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $context | Out-Null

    $trackedFiles = & git -C $Root ls-files
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to enumerate tracked files for the container build context."
    }

    foreach ($relativePath in $trackedFiles) {
        $source = Join-Path $Root $relativePath
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            continue
        }
        $destination = Join-Path $context $relativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
    }

    return $context
}

function Invoke-AcrBuild {
    param(
        [string]$Registry,
        [string]$Image,
        [string]$Dockerfile,
        [string]$Context
    )

    $runId = & az acr build `
        --registry $Registry `
        --image $Image `
        --file $Dockerfile `
        --no-logs `
        --only-show-errors `
        --query runId `
        --output tsv `
        $Context
    if ($LASTEXITCODE -ne 0 -or -not $runId) {
        throw "Unable to queue ACR build for $Image."
    }

    $deadline = (Get-Date).AddMinutes(20)
    do {
        $status = & az acr task show-run `
            --registry $Registry `
            --run-id $runId `
            --query status `
            --output tsv `
            --only-show-errors
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to read ACR build $runId for $Image."
        }
        Write-Host "ACR build $runId for $Image`: $status"
        if ($status -eq "Succeeded") {
            return
        }
        if ($status -in @("Failed", "Canceled", "Error", "Timeout")) {
            throw "ACR build $runId for $Image finished with status $status."
        }
        Start-Sleep -Seconds 15
    } while ((Get-Date) -lt $deadline)

    throw "ACR build $runId for $Image did not finish within 20 minutes."
}

$environmentPath = Join-Path $repositoryRoot $BackendEnvironmentFile
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
    throw "Backend environment file not found: $environmentPath"
}

$configuration = Read-DotEnv -Path $environmentPath
$subscriptionId = Get-RequiredValue -Values $configuration -Name "AZURE_SUBSCRIPTION_ID"
$platformLocation = Get-RequiredValue -Values $configuration -Name "PLATFORM_LOCATION"

if (-not $StorageResourceGroupName) {
    $StorageResourceGroupName = Get-RequiredValue -Values $configuration -Name "PLATFORM_STORAGE_RESOURCE_GROUP"
}
if (-not $StorageAccountName) {
    $StorageAccountName = Get-RequiredValue -Values $configuration -Name "PLATFORM_STORAGE_ACCOUNT_NAME"
}
if (-not $ImageTag) {
    $ImageTag = Get-Date -Format "yyyyMMddHHmmss"
}

foreach ($command in @("az", "kubectl")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command is required but was not found."
    }
}

$buildContext = $null
Push-Location $repositoryRoot
try {
    Invoke-Native -Command "az" -Arguments @(
        "account", "set",
        "--subscription", $subscriptionId
    )

    $deploymentName = "ai-launchpad-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $deploymentJson = & az deployment sub create `
        --name $deploymentName `
        --location $platformLocation `
        --template-file (Join-Path $PSScriptRoot "main.bicep") `
        --parameters `
            "location=$platformLocation" `
            "portalResourceGroupName=$PortalResourceGroupName" `
            "aksResourceGroupName=$AksResourceGroupName" `
            "aksClusterName=$AksClusterName" `
            "acrResourceGroupName=$AcrResourceGroupName" `
            "acrName=$AcrName" `
            "storageResourceGroupName=$StorageResourceGroupName" `
            "storageAccountName=$StorageAccountName" `
            "artifactContainerName=$ArtifactContainerName" `
            "kubernetesNamespace=$KubernetesNamespace" `
            "backendServiceAccountName=$BackendServiceAccountName" `
            "backendIdentityName=$BackendIdentityName" `
        --only-show-errors `
        --output json
    if ($LASTEXITCODE -ne 0) {
        throw "Azure infrastructure deployment failed."
    }

    $deployment = $deploymentJson | ConvertFrom-Json
    $outputs = $deployment.properties.outputs
    $acrLoginServer = $outputs.acrLoginServer.value
    $artifactContainerUrl = $outputs.artifactContainerUrl.value
    $backendClientId = $outputs.backendIdentityClientId.value
    $buildContext = New-TrackedBuildContext -Root $repositoryRoot

    Invoke-AcrBuild `
        -Registry $AcrName `
        -Image "launchpad-backend:$ImageTag" `
        -Dockerfile "backend/Dockerfile" `
        -Context $buildContext
    Invoke-AcrBuild `
        -Registry $AcrName `
        -Image "launchpad-frontend:$ImageTag" `
        -Dockerfile "frontend/Dockerfile" `
        -Context $buildContext

    Invoke-Native -Command "az" -Arguments @(
        "aks", "get-credentials",
        "--resource-group", $AksResourceGroupName,
        "--name", $AksClusterName,
        "--subscription", $subscriptionId,
        "--overwrite-existing",
        "--only-show-errors"
    )

    $template = Get-Content -LiteralPath (Join-Path $PSScriptRoot "k8s\launchpad.yaml") -Raw
    $replacements = @{
        "__NAMESPACE__" = $KubernetesNamespace
        "__SERVICE_ACCOUNT__" = $BackendServiceAccountName
        "__BACKEND_CLIENT_ID__" = $backendClientId
        "__ACR_LOGIN_SERVER__" = $acrLoginServer
        "__IMAGE_TAG__" = $ImageTag
        "__SUBSCRIPTION_ID__" = $subscriptionId
        "__ENABLE_AZURE_DEPLOYMENTS__" = $EnableAzureDeployments.IsPresent.ToString().ToLowerInvariant()
        "__ARTIFACT_CONTAINER_URL__" = $artifactContainerUrl
        "__PLATFORM_LOCATION__" = $platformLocation
        "__PLATFORM_FOUNDRY_RESOURCE_GROUP__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_FOUNDRY_RESOURCE_GROUP"
        "__PLATFORM_FOUNDRY_ACCOUNT_NAME__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_FOUNDRY_ACCOUNT_NAME"
        "__PLATFORM_STORAGE_RESOURCE_GROUP__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_STORAGE_RESOURCE_GROUP"
        "__PLATFORM_STORAGE_ACCOUNT_NAME__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_STORAGE_ACCOUNT_NAME"
        "__PLATFORM_COSMOS_RESOURCE_GROUP__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_COSMOS_RESOURCE_GROUP"
        "__PLATFORM_COSMOS_ACCOUNT_NAME__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_COSMOS_ACCOUNT_NAME"
        "__PLATFORM_COSMOS_DATABASE_NAME__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_COSMOS_DATABASE_NAME"
        "__PLATFORM_SEARCH_RESOURCE_GROUP__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_SEARCH_RESOURCE_GROUP"
        "__PLATFORM_SEARCH_SERVICE_NAME__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_SEARCH_SERVICE_NAME"
        "__PLATFORM_SEARCH_INDEX_NAME__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_SEARCH_INDEX_NAME"
        "__PLATFORM_MANAGED_IDENTITY_RESOURCE_ID__" = Get-RequiredValue -Values $configuration -Name "PLATFORM_MANAGED_IDENTITY_RESOURCE_ID"
    }
    foreach ($replacement in $replacements.GetEnumerator()) {
        $template = $template.Replace($replacement.Key, $replacement.Value)
    }
    if ($template -match "__[A-Z0-9_]+__") {
        throw "The Kubernetes manifest still contains unresolved placeholders."
    }

    $runtimeDirectory = Join-Path $repositoryRoot ".runtime"
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $renderedManifest = Join-Path $runtimeDirectory "launchpad-$ImageTag.yaml"
    try {
        Set-Content -LiteralPath $renderedManifest -Value $template -Encoding utf8
        Invoke-Native -Command "kubectl" -Arguments @("apply", "-f", $renderedManifest)
        Invoke-Native -Command "kubectl" -Arguments @(
            "rollout", "status",
            "deployment/launchpad-backend",
            "--namespace", $KubernetesNamespace,
            "--timeout=5m"
        )
        Invoke-Native -Command "kubectl" -Arguments @(
            "rollout", "status",
            "deployment/launchpad-frontend",
            "--namespace", $KubernetesNamespace,
            "--timeout=5m"
        )
    }
    finally {
        Remove-Item -LiteralPath $renderedManifest -ErrorAction SilentlyContinue
    }

    Write-Host "AI Launchpad deployed to AKS."
    Write-Host "Artifact container: $artifactContainerUrl"
    Write-Host "Frontend service: launchpad-frontend (LoadBalancer)"
}
finally {
    Pop-Location
    if ($buildContext -and (Test-Path -LiteralPath $buildContext)) {
        Remove-Item -LiteralPath $buildContext -Recurse -Force
    }
}
