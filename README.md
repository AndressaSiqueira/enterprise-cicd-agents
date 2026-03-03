# Enterprise CI/CD with Agentic Governance

[![CI](https://github.com/your-org/enterprise-cicd-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/enterprise-cicd-agents/actions/workflows/ci.yml)
[![CD](https://github.com/your-org/enterprise-cicd-agents/actions/workflows/cd.yml/badge.svg)](https://github.com/your-org/enterprise-cicd-agents/actions/workflows/cd.yml)

A production-ready demonstration of **agentic CI/CD governance** using GitHub Actions. This system uses autonomous agents to analyze code changes, run security scans, and enforce policies—with an Observer Agent providing centralized governance.

## 🎯 Core Principles

- **Nothing Hardcoded**: All decisions come from policies, real outputs, and GitHub context
- **Policy-as-Code**: Governance rules defined in YAML, versioned with your code
- **Full Auditability**: Every decision includes evidence, timestamps, and cryptographic hashes
- **Environment Protection**: Production requires human approval via GitHub Environments

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Actions                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  IaC Agent  │  │ CI/CD Agent │  │Security Agent│              │
│  │  (git diff) │  │  (npm test) │  │ (npm audit) │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         └────────┬───────┴───────┬────────┘                      │
│                  │               │                               │
│                  ▼               ▼                               │
│            ┌─────────────────────────┐                          │
│            │    Observer Agent       │◄── policies/agent-policies.yaml
│            │  (Governance Control)   │                          │
│            └───────────┬─────────────┘                          │
│                        │                                        │
│         ┌──────────────┼──────────────┐                         │
│         ▼              ▼              ▼                         │
│     ┌───────┐    ┌──────────┐   ┌───────────┐                   │
│     │ ALLOW │    │  DENY    │   │CONDITIONAL│                   │
│     └───┬───┘    └────┬─────┘   └─────┬─────┘                   │
│         │             │               │                         │
│         ▼             ▼               ▼                         │
│    [Deploy]      [Block CI]    [Await Approval]                 │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/enterprise-cicd-agents.git
cd enterprise-cicd-agents
npm install

# Run locally
npm run ci:local
```

## 📁 Project Structure

```
.
├── app/                          # Production application
│   ├── index.ts                  # Enterprise API service
│   └── index.test.ts             # Unit tests
├── src/
│   ├── agents/
│   │   ├── iac-agent/            # Infrastructure change detection
│   │   ├── cicd-agent/           # Test result analysis
│   │   ├── security-agent/       # Vulnerability scanning
│   │   └── observer-agent/       # Governance control plane
│   └── shared/
│       ├── types.ts              # Shared type definitions
│       └── telemetry.ts          # OTEL instrumentation
├── policies/
│   └── agent-policies.yaml       # Governance rules
├── infra/
│   ├── staging/                  # Staging IaC
│   └── prod/                     # Production IaC
├── docs/
│   ├── README.md                 # Detailed documentation
│   ├── architecture.md           # Architecture diagrams
│   └── rai.md                    # OTEL & responsible AI
└── .github/workflows/
    ├── ci.yml                    # CI pipeline with agents
    └── cd.yml                    # CD pipeline with environments
```

## 🤖 Agents

| Agent | Purpose | Analyzes | Generates |
|-------|---------|----------|-----------|
| **IaC Agent** | Detect infra changes | `git diff` | `plan_infra`, `apply_infra` |
| **CI/CD Agent** | Evaluate test health | `npm test` | `verify_pipeline`, `rerun_pipeline` |
| **Security Agent** | Find vulnerabilities | `npm audit` | `block_pr`, `approve_security` |
| **Observer Agent** | Enforce policies | All intents | Decisions + Summary |

## 📜 Policy Example

```yaml
# policies/agent-policies.yaml
iac-agent:
  rules:
    - action: apply_infra
      scope: prod
      decision: deny
      reason: "Production changes require manual process"
```

## 🔒 Environment Setup

1. Create `staging` environment (no protection)
2. Create `production` environment with **Required Reviewers**

See [docs/README.md](docs/README.md) for detailed setup instructions.

## 📊 Scripts

```bash
npm run build          # Compile TypeScript
npm test               # Run tests
npm run lint           # ESLint check
npm run agents:run     # Run all 3 agents
npm run observer:run   # Evaluate intents
npm run ci:local       # Full local CI simulation
```

## 📖 Documentation

- [Detailed Setup & Usage](docs/README.md)
- [Architecture & Data Flow](docs/architecture.md)
- [OTEL & Responsible AI](docs/rai.md)

## License

MIT
