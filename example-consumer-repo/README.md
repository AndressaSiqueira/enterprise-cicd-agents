# Example: Payments Service

This is an example microservice that demonstrates how to integrate with the **Enterprise Governance SDK** for AI-powered CI/CD decisions.

## How it Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    This Repository                              │
│                                                                 │
│   1. Developer opens PR                                         │
│      └──▶ pr-check.yml runs                                     │
│           └──▶ Calls Governance SDK                             │
│                ├── analyze-pr       → AI reviews code           │
│                └── security-scan    → Checks vulnerabilities    │
│                                                                 │
│   2. PR merged to main                                          │
│      └──▶ deploy.yml runs                                       │
│           └──▶ Calls Governance SDK                             │
│                └── multi-repo-check → Checks dependencies,      │
│                                       Azure Monitor, Grafana    │
│                                                                 │
│   3. If approved → Deploy to staging → Deploy to production     │
│      If blocked  → Pipeline fails with explanation              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Enterprise Governance SDK (external service)            │
│         https://ca-governance-prod.azurecontainerapps.io        │
│                                                                 │
│   - Runs 24/7 on Azure Container Apps                           │
│   - Has context of ALL repos (dependencies, health, alerts)     │
│   - Uses GitHub Copilot SDK for AI decisions                    │
│   - Connects to Azure Monitor + Grafana for system health       │
└─────────────────────────────────────────────────────────────────┘
```

## Workflows

### 1. PR Check (`.github/workflows/pr-check.yml`)

Runs on every PR to analyze code quality and security:

- Calls `/api/governance/analyze-pr` - AI reviews the PR
- Calls `/api/governance/security-scan` - Checks for vulnerabilities
- Comments on PR with analysis
- Blocks merge if `recommendation: block`

### 2. Deploy (`.github/workflows/deploy.yml`)

Runs on push to main or manual trigger:

- Calls `/api/governance/multi-repo-check` - Checks if safe to deploy
- Verifies dependencies are healthy
- Checks Azure Monitor for incidents
- Checks Grafana for active alerts
- Deploys to staging (if APPROVE or REVIEW)
- Deploys to production (only if APPROVE)

## Setup

### 1. Add to your repo

Copy these files to your repository:

```
.github/
  workflows/
    pr-check.yml
    deploy.yml
```

### 2. Configure secrets

No additional secrets needed - uses `GITHUB_TOKEN` automatically.

### 3. (Optional) Register in dependency map

If your repo has dependencies on other repos, ask the platform team to add it to `config/dependencies.yaml` in the Governance SDK repo:

```yaml
repositories:
  your-repo-name:
    description: "Your service description"
    dependencies:
      - repo-it-depends-on
      - another-dependency
    critical: true  # if production critical
```

## What the Governance SDK Checks

### On PR Analysis:
- Code quality and best practices
- Security patterns
- Test coverage
- Infrastructure changes
- Breaking changes

### On Deploy:
- Dependency health (are services you depend on healthy?)
- Active incidents in Azure Monitor
- Active alerts in Grafana
- Breaking changes in dependencies
- Policy compliance

## Example Responses

### PR Approved:
```json
{
  "recommendation": "approve",
  "riskLevel": "low",
  "aiAnalysis": "This PR adds a new endpoint with proper error handling..."
}
```

### Deploy Blocked:
```json
{
  "decision": "BLOCK",
  "factors": [
    {"type": "error", "source": "azure-monitor", "message": "2 active P1 incidents"},
    {"type": "error", "source": "github", "message": "Dependency repo-auth has breaking changes"}
  ],
  "aiAnalysis": "Cannot deploy because repo-auth has pending breaking changes that would affect this service..."
}
```

## Local Development

```bash
npm install
npm run dev
```

## Questions?

Contact the Platform Team or check the [Governance SDK documentation](https://github.com/AndressaSiqueira/enterprise-cicd-agents).
