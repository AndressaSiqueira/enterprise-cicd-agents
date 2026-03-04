# AGENTS.md - Enterprise CI/CD Governance SDK

This file provides instructions for AI agents working with this codebase.

## Project Overview

This is an **Enterprise CI/CD Governance Server** powered by the **GitHub Copilot SDK**. It provides AI-driven governance decisions for pull requests, security scanning, and deployment approvals.

**Key Point**: This is a **service** that other repositories consume, not a self-contained CI/CD pipeline.

## Architecture

```
enterprise-cicd-agents/
├── src/
│   ├── server/           # Express API server with Copilot SDK
│   │   ├── index.ts      # Main server with governance endpoints
│   │   ├── tools.ts      # Copilot SDK tool definitions
│   │   └── prompts.ts    # System prompts for AI behavior
│   ├── mcp/              # Model Context Protocol server
│   │   └── server.ts     # MCP server for Copilot Chat integration
│   └── shared/           # Shared utilities
│       ├── types.ts      # TypeScript type definitions
│       ├── telemetry.ts  # OpenTelemetry instrumentation
│       └── index.ts      # Shared exports
├── examples/             # Integration examples for other repos
├── infra/                # Infrastructure as Code (Bicep/Terraform)
├── policies/             # Policy-as-code YAML files
├── .github/workflows/    # CI/CD for this server
└── docs/                 # Documentation
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     Other Repositories                          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Repo A     │  │   Repo B     │  │   Repo C     │          │
│  │  (any app)   │  │  (any app)   │  │  (any app)   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └────────────────┬┴─────────────────┘                   │
│                          │                                      │
│                          ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              Governance SDK Server                         │ │
│  │         (this repo, deployed on Azure)                     │ │
│  │                                                            │ │
│  │  POST /api/governance/analyze-pr                           │ │
│  │  POST /api/governance/security-scan                        │ │
│  │  POST /api/governance/deployment-decision                  │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │           GitHub Copilot SDK                          │ │ │
│  │  │     (AI-powered analysis and decisions)               │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/governance/chat` | POST | Interactive governance chat |
| `/api/governance/analyze-pr` | POST | Analyze a pull request |
| `/api/governance/security-scan` | POST | Security vulnerability scanning |
| `/api/governance/deployment-decision` | POST | Deployment approval decisions |
| `/health` | GET | Health check |

## MCP Tools (for Copilot Chat)

The MCP server exposes these tools:

- `analyze_pull_request` - Comprehensive PR analysis
- `check_security_vulnerabilities` - Security scanning
- `evaluate_deployment_readiness` - Deployment checklist
- `check_policy_compliance` - Policy validation

## Development

```bash
# Install dependencies
npm ci

# Run locally
npm run dev

# Run tests
npm test

# Run lint
npm run lint

# Start MCP server
npm run mcp:start
```

## Deployment

The server is deployed to Azure Container Apps:

- **Staging**: `https://ca-governance-staging.azurecontainerapps.io`
- **Production**: `https://ca-governance-prod.azurecontainerapps.io`

```bash
# Build Docker image
docker build -t governance-sdk .

# Run locally
docker run -p 3000:3000 -e GITHUB_TOKEN=$GITHUB_TOKEN governance-sdk
```

## Integrating with Other Repositories

See the [examples/](./examples) folder for:

1. **GitHub Actions workflow** - Call the API from your CI
2. **Webhook handler** - Automate PR analysis via webhooks

Quick example for your repo's workflow:

```yaml
- name: Governance Check
  run: |
    curl -X POST \
      -H "Authorization: Bearer ${{ secrets.GITHUB_TOKEN }}" \
      -d '{"owner":"${{ github.repository_owner }}","repo":"${{ github.event.repository.name }}","prNumber":${{ github.event.pull_request.number }}}' \
      https://ca-governance-prod.azurecontainerapps.io/api/governance/analyze-pr
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub token with repo access |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OpenTelemetry collector endpoint |

## AI Behavior Guidelines

The governance AI follows these principles:

1. **Conservative by Default**: When uncertain, recommend REVIEW over APPROVE
2. **Evidence-Based**: All decisions cite specific evidence from the codebase
3. **Security First**: Security concerns escalate risk levels
4. **Production Protection**: Production changes always require extra scrutiny
5. **Transparent Reasoning**: Always explain why a decision was made

## Development Guidelines

### When modifying API endpoints:
1. Update tool definitions in `src/server/tools.ts`
2. Ensure OpenTelemetry spans are properly created
3. Add error handling that doesn't expose internal details
4. Update the corresponding MCP tool if applicable

### When adding new governance rules:
1. Add rules to `policies/agent-policies.yaml`
2. Update the `check_policy_compliance` tool handler

### When modifying prompts:
1. Edit `src/server/prompts.ts`
2. Keep prompts focused on governance decisions
3. Maintain the risk level and recommendation framework
