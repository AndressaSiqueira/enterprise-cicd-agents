# Enterprise CI/CD with Agentic Workflows

This repository demonstrates an enterprise-grade CI/CD pipeline with **agentic governance** using GitHub Actions. The system uses policy-as-code to make automated decisions about deployments, security, and infrastructure changes.

## Overview

The pipeline consists of multiple specialized agents that analyze different aspects of your codebase and generate **intents** (proposed actions). These intents are then evaluated by an **Observer Agent** against policy rules defined in YAML.

### Key Principles

1. **Nothing Hardcoded**: All decisions come from:
   - Policy-as-code files (`/policies/agent-policies.yaml`)
   - Actual PR diffs and changed files
   - Real test/lint/audit outputs
   - GitHub context variables

2. **Deterministic Governance**: Explicit deny rules always win, and unknown actions require human approval.

3. **Full Auditability**: Every decision includes evidence (changed files, test results, audit summaries) with cryptographic hashes.

## Quick Start

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run all agents locally
npm run agents:run

# Run observer to evaluate intents
npm run observer:run

# Simulate full CI locally
npm run ci:local
```

## GitHub Environment Configuration

### Setting Up Environments

1. Go to your repository **Settings** → **Environments**

2. **Create `staging` environment:**
   - Click "New environment"
   - Name: `staging`
   - No protection rules needed (automatic deployment)

3. **Create `production` environment:**
   - Click "New environment"
   - Name: `production`
   - Enable **Required reviewers**
   - Add team members or specific users who can approve deployments
   - Optionally set **Wait timer** for additional delay
   - Optionally restrict to specific branches (e.g., `main`)

### Protection Rules for Production

Configure these settings for the `production` environment:

| Setting | Recommended Value |
|---------|-------------------|
| Required reviewers | 1-2 team members |
| Wait timer | 0-15 minutes |
| Deployment branches | `main` only |
| Allow administrators to bypass | Optional (for emergencies) |

## Finding Artifacts and Results

### During PR Review

1. **PR Comment**: The Observer Agent posts a governance summary directly as a PR comment
2. **Checks Tab**: View detailed status of each agent
3. **Actions Tab**: Access full logs and artifacts

### Artifacts Location

After each workflow run, find artifacts in the **Actions** tab:

| Artifact | Contents |
|----------|----------|
| `agent-intents` | Individual intent.json from each agent |
| `observer-decisions` | Decision files and summary.md |
| `security-audit` | Raw npm audit output |
| `test-results` | Jest test results JSON |
| `production-governance` | Pre-production governance check results |
| `production-deployment-evidence` | Deployment record and audit trail |

### Interpreting the Summary

The governance summary shows:

```
✅ PASS - All checks passed, deployment proceeds
❌ FAIL - One or more agents DENIED, workflow blocked
⏳ PENDING_APPROVAL - Conditional decisions require human approval
```

## Agents Reference

### IaC Agent (`/src/agents/iac-agent`)
- **Purpose**: Detects infrastructure changes
- **Input**: Git diff of changed files
- **Actions Generated**:
  - `plan_infra`: When IaC files change (non-prod)
  - `apply_infra`: When production IaC changes (denied by policy)
  - `verify_pipeline`: No IaC changes

### CI/CD Agent (`/src/agents/cicd-agent`)
- **Purpose**: Analyzes test results
- **Input**: `npm test` output
- **Actions Generated**:
  - `verify_pipeline`: Tests passed
  - `rerun_pipeline`: Tests failed in non-prod

### Security Agent (`/src/agents/security-agent`)
- **Purpose**: Security vulnerability scanning
- **Input**: `npm audit --json`
- **Actions Generated**:
  - `block_pr`: High/critical vulnerabilities found
  - `approve_security`: No blocking vulnerabilities

### Observer Agent (`/src/agents/observer-agent`)
- **Purpose**: Governance control plane
- **Input**: All intent files + policies YAML
- **Output**: Decision files + summary.md

## Policy Configuration

Edit `/policies/agent-policies.yaml` to customize governance rules:

```yaml
# Example: Allow staging deployments without approval
cicd-agent:
  rules:
    - action: deploy
      scope: staging
      decision: allow
      reason: "Staging deployments are automatic"
```

## Extending the System

### Adding a New Agent

1. Create directory: `/src/agents/your-agent/`
2. Implement agent logic following the pattern in existing agents
3. Output `intent.json` in the agent directory
4. Add agent directory to Observer Agent's scan list
5. Add policy rules for the new agent

### Adding New Policy Rules

Add rules in `/policies/agent-policies.yaml`:

```yaml
your-agent:
  rules:
    - action: your_action
      scope: "*"
      decision: allow
      reason: "Explanation for audit trail"
```

## Troubleshooting

### Workflow Blocked Unexpectedly

1. Check the PR comment or summary.md artifact
2. Review which agent generated a `deny` or `conditional` decision
3. Check the `evidence` field in decision files for context
4. Verify policy rules in `agent-policies.yaml`

### Agents Not Running

1. Ensure `fetch-depth: 0` is set in checkout action (needed for git diff)
2. Check GitHub context environment variables are set
3. Review agent logs in workflow run

### Environment Approval Not Working

1. Verify environment is created in repository settings
2. Check required reviewers are configured
3. Ensure the workflow job uses correct `environment:` key

## License

MIT License
