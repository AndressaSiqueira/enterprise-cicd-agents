# AGENTS.md - Enterprise CI/CD Governance Agent Instructions

This file provides custom instructions for AI agents working with this codebase.

## Project Overview

This is an **Enterprise CI/CD Governance** application powered by the **GitHub Copilot SDK**. It provides AI-driven governance decisions for pull requests, security scanning, and deployment approvals.

## Architecture

```
enterprise-cicd-agents/
├── src/
│   ├── server/           # Express API server with Copilot SDK integration
│   │   ├── index.ts      # Main server with governance endpoints
│   │   ├── tools.ts      # Copilot SDK tool definitions
│   │   └── prompts.ts    # System prompts for AI behavior
│   ├── mcp/              # Model Context Protocol server
│   │   └── server.ts     # MCP server exposing governance tools
│   ├── agents/           # Legacy rule-based agents (for CI integration)
│   │   ├── iac-agent/    # Infrastructure change detection
│   │   ├── cicd-agent/   # Test result analysis
│   │   ├── security-agent/  # npm audit wrapper
│   │   └── observer-agent/  # Policy evaluation
│   └── shared/           # Shared utilities
│       ├── types.ts      # TypeScript type definitions
│       ├── telemetry.ts  # OpenTelemetry instrumentation
│       └── index.ts      # Shared exports
├── app/                  # Sample application (for demo)
├── infra/                # Sample IaC files (staging/prod)
├── policies/             # Policy-as-code YAML files
├── .github/workflows/    # GitHub Actions CI/CD workflows
└── docs/                 # Documentation
```

## Key Components

### 1. Governance API Server (`src/server/`)

Express server that exposes REST endpoints powered by Copilot SDK:

- `POST /api/governance/chat` - Interactive governance chat
- `POST /api/governance/analyze-pr` - Analyze a pull request
- `POST /api/governance/security-scan` - Security vulnerability scanning
- `POST /api/governance/deployment-decision` - Deployment approval decisions
- `GET /health` - Health check

### 2. MCP Server (`src/mcp/`)

Model Context Protocol server that exposes tools for AI assistants:

- `analyze_pull_request` - Comprehensive PR analysis
- `check_security_vulnerabilities` - Security scanning
- `evaluate_deployment_readiness` - Deployment checklist
- `get_infrastructure_changes` - IaC change detection
- `generate_governance_report` - Markdown report generation
- `check_policy_compliance` - Policy validation

### 3. Legacy Agents (`src/agents/`)

Rule-based agents for GitHub Actions integration:

- **iac-agent**: Detects infrastructure changes via git diff
- **cicd-agent**: Analyzes test results
- **security-agent**: Runs npm audit
- **observer-agent**: Evaluates intents against policies

## Development Guidelines

### When modifying API endpoints:
1. Update the tool definitions in `src/server/tools.ts`
2. Ensure OpenTelemetry spans are properly created
3. Add error handling that doesn't expose internal details
4. Update the corresponding MCP tool if applicable

### When adding new governance rules:
1. Add rules to `policies/agent-policies.yaml`
2. Update the `check_policy_compliance` tool handler
3. Document the rule in this file

### When modifying prompts:
1. Edit `src/server/prompts.ts`
2. Keep prompts focused on governance decisions
3. Maintain the risk level and recommendation framework

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub token with repo access |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OpenTelemetry collector endpoint |

## Testing

```bash
# Run unit tests
npm test

# Run linting
npm run lint

# Test locally
npm run dev
curl http://localhost:3000/health

# Run MCP server
npm run mcp:start
```

## Deployment

The application is designed for Azure Container Apps deployment:

```bash
# Build and deploy
azd up

# Or with Docker
docker build -t enterprise-cicd-agents .
docker run -p 3000:3000 -e GITHUB_TOKEN=$GITHUB_TOKEN enterprise-cicd-agents
```

## Security Considerations

1. **Token Handling**: GITHUB_TOKEN should be stored in Azure Key Vault or GitHub Secrets
2. **No Secrets in Code**: Never commit tokens or credentials
3. **Audit Logging**: All governance decisions are traced via OpenTelemetry
4. **Rate Limiting**: Consider adding rate limiting for production

## AI Behavior Guidelines

The governance AI follows these principles:

1. **Conservative by Default**: When uncertain, recommend REVIEW over APPROVE
2. **Evidence-Based**: All decisions cite specific evidence from the codebase
3. **Security First**: Security concerns escalate risk levels
4. **Production Protection**: Production changes always require extra scrutiny
5. **Transparent Reasoning**: Always explain why a decision was made

## Copilot SDK Integration

This project uses `@github/copilot-sdk` for AI capabilities:

```typescript
import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient({ token: GITHUB_TOKEN });
const session = await client.createSession({
  systemPrompt: governancePrompt,
  tools: governanceTools
});
const response = await session.sendAndWait(message);
```

## MCP Integration

Run the MCP server to expose tools to AI assistants:

```bash
npm run mcp:start
```

Configure in your AI assistant's MCP settings using `mcp.json`.
