# Integration Examples

This folder contains examples of how other repositories can integrate with the Governance SDK Server.

## Available Examples

### 1. GitHub Actions Workflow Integration

See [github-workflow-integration.yml](./github-workflow-integration.yml) - A workflow that other repos can use to call the Governance API for PR analysis before merging.

### 2. Webhook Integration

See [webhook-handler.ts](./webhook-handler.ts) - A sample webhook handler that receives GitHub events and calls the Governance API.

## Quick Start

### Option A: REST API Call in your CI

```yaml
# Add this job to your repo's CI workflow
governance-check:
  runs-on: ubuntu-latest
  steps:
    - name: Call Governance API
      run: |
        RESPONSE=$(curl -X POST \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer ${{ secrets.GOVERNANCE_API_TOKEN }}" \
          -d '{
            "owner": "${{ github.repository_owner }}",
            "repo": "${{ github.event.repository.name }}",
            "prNumber": ${{ github.event.pull_request.number }}
          }' \
          https://ca-governance-prod.azurecontainerapps.io/api/governance/analyze-pr)
        
        echo "$RESPONSE"
        
        # Check decision
        DECISION=$(echo $RESPONSE | jq -r '.decision')
        if [ "$DECISION" = "DENY" ]; then
          exit 1
        fi
```

### Option B: MCP Server in VS Code / Copilot Chat

Configure your `.vscode/mcp.json`:

```json
{
  "servers": {
    "governance": {
      "type": "sse",
      "url": "https://ca-governance-prod.azurecontainerapps.io/mcp"
    }
  }
}
```

Then use tools like `analyze_pull_request` directly in Copilot Chat.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/governance/analyze-pr` | POST | Analyze a PR for governance |
| `/api/governance/security-scan` | POST | Scan for vulnerabilities |
| `/api/governance/deployment-decision` | POST | Get deployment approval decision |
| `/api/governance/chat` | POST | Interactive governance chat |
| `/health` | GET | Health check |
