# Architecture Overview

This document describes the architecture of the agentic CI/CD governance system.

## System Architecture

```mermaid
flowchart TB
    subgraph "GitHub Events"
        PR[Pull Request]
        Push[Push to main]
    end

    subgraph "CI Pipeline"
        Checkout[Checkout Code]
        Build[Build & Test]
        Lint[Lint Check]
    end

    subgraph "Governance Agents"
        direction TB
        IAC[IaC Agent]
        CICD[CI/CD Agent]
        SEC[Security Agent]
    end

    subgraph "Observer Control Plane"
        OBS[Observer Agent]
        POL[(Policies YAML)]
    end

    subgraph "Outputs"
        DEC[/Decisions/]
        SUM[/Summary.md/]
        ART[/Artifacts/]
    end

    subgraph "Deployment"
        STG[Staging Environment]
        GATE{Approval Gate}
        PROD[Production Environment]
    end

    PR --> Checkout
    Push --> Checkout
    Checkout --> Build
    Build --> Lint
    
    Lint --> IAC
    Lint --> CICD
    Lint --> SEC
    
    IAC --> |intent.json| OBS
    CICD --> |intent.json| OBS
    SEC --> |intent.json| OBS
    
    POL --> OBS
    
    OBS --> DEC
    OBS --> SUM
    DEC --> ART
    SUM --> ART
    
    OBS --> |pass| STG
    OBS --> |deny| BLOCK[❌ Block]
    
    STG --> OBS
    OBS --> |conditional| GATE
    GATE --> |approved| PROD
    GATE --> |rejected| BLOCK2[❌ Rejected]
```

## Data Flow

```mermaid
sequenceDiagram
    participant GH as GitHub Actions
    participant IAC as IaC Agent
    participant CICD as CI/CD Agent
    participant SEC as Security Agent
    participant OBS as Observer Agent
    participant POL as Policies
    participant ENV as Environments

    GH->>GH: Checkout, Build, Test
    
    par Run Agents
        GH->>IAC: Execute
        IAC->>IAC: git diff analysis
        IAC-->>GH: intent.json
    and
        GH->>CICD: Execute
        CICD->>CICD: npm test analysis
        CICD-->>GH: intent.json
    and
        GH->>SEC: Execute
        SEC->>SEC: npm audit analysis
        SEC-->>GH: intent.json
    end
    
    GH->>OBS: Execute
    OBS->>POL: Load policies
    OBS->>OBS: Load all intents
    
    loop For each intent
        OBS->>OBS: Find matching rule
        OBS->>OBS: Generate decision
    end
    
    OBS-->>GH: decisions/*.json
    OBS-->>GH: summary.md
    
    alt All decisions = allow
        GH->>ENV: Deploy to staging
        ENV-->>GH: Success
        GH->>ENV: Deploy to production
    else Any decision = deny
        GH->>GH: Block workflow
    else Any decision = conditional
        GH->>ENV: Request approval
        ENV-->>GH: Human approval
        GH->>ENV: Deploy to production
    end
```

## Component Details

### Agent Layer

Each agent is responsible for a specific domain:

| Agent | Domain | Inputs | Outputs |
|-------|--------|--------|---------|
| IaC Agent | Infrastructure changes | Git diff | `plan_infra`, `apply_infra` |
| CI/CD Agent | Test health | Jest results | `verify_pipeline`, `rerun_pipeline` |
| Security Agent | Vulnerabilities | npm audit | `block_pr`, `approve_security` |

### Observer Agent (Control Plane)

The Observer Agent acts as the governance control plane:

```mermaid
flowchart LR
    subgraph "Inputs"
        I1[iac-agent/intent.json]
        I2[cicd-agent/intent.json]
        I3[security-agent/intent.json]
        P[agent-policies.yaml]
    end
    
    subgraph "Processing"
        LOAD[Load Intents]
        EVAL[Evaluate Rules]
        HASH[Compute Hashes]
        DEC[Generate Decisions]
    end
    
    subgraph "Outputs"
        D1[iac-agent.decision.json]
        D2[cicd-agent.decision.json]
        D3[security-agent.decision.json]
        SUM[summary.md]
        STAT[status.json]
    end
    
    I1 --> LOAD
    I2 --> LOAD
    I3 --> LOAD
    P --> EVAL
    
    LOAD --> EVAL
    EVAL --> HASH
    HASH --> DEC
    
    DEC --> D1
    DEC --> D2
    DEC --> D3
    DEC --> SUM
    DEC --> STAT
```

### Policy Evaluation Logic

```mermaid
flowchart TD
    START[Receive Intent] --> CHECK1{Agent-specific<br/>rules exist?}
    
    CHECK1 -->|Yes| MATCH1{Action & Scope<br/>match rule?}
    CHECK1 -->|No| DEFAULT
    
    MATCH1 -->|Yes| APPLY1[Apply agent rule]
    MATCH1 -->|No| DEFAULT
    
    DEFAULT[Check default rules] --> MATCH2{Match found?}
    
    MATCH2 -->|Yes| APPLY2[Apply default rule]
    MATCH2 -->|No| COND[Return conditional<br/>+ human approval required]
    
    APPLY1 --> OUTPUT[Generate Decision]
    APPLY2 --> OUTPUT
    COND --> OUTPUT
    
    OUTPUT --> EVIDENCE[Attach Evidence]
    EVIDENCE --> HASH[Compute Intent Hash]
    HASH --> DONE[Write Decision File]
```

### Environment Protection Flow

```mermaid
stateDiagram-v2
    [*] --> Staging
    
    Staging --> GovernanceCheck: Deploy success
    
    GovernanceCheck --> Approved: All allow
    GovernanceCheck --> PendingApproval: Has conditional
    GovernanceCheck --> Blocked: Has deny
    
    PendingApproval --> WaitingForReviewer
    WaitingForReviewer --> Approved: Reviewer approves
    WaitingForReviewer --> Rejected: Reviewer rejects
    
    Approved --> Production
    Blocked --> [*]
    Rejected --> [*]
    
    Production --> [*]
```

## Security Considerations

1. **Least Privilege**: Workflows use minimal permissions
2. **Audit Trail**: All decisions include evidence and hashes
3. **Policy Separation**: Policies stored separately from code
4. **Environment Protection**: Production requires explicit approval
5. **Artifact Retention**: Governance artifacts retained for compliance

## Extensibility Points

1. **New Agents**: Add to `/src/agents/` following existing patterns
2. **New Policies**: Update `/policies/agent-policies.yaml`
3. **Custom Exporters**: Replace console OTEL exporter with OTLP
4. **Notifications**: Add to notification job in CD workflow
