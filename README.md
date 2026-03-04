# CI/CD Governance API

API REST que usa o **GitHub Copilot SDK** para decisões de governança automatizadas em CI/CD.

## O que faz

| Endpoint | Função |
|----------|--------|
| `POST /api/governance/analyze-pr` | Analisa PRs e decide: approve/review/block |
| `POST /api/governance/security-scan` | Verifica vulnerabilidades (GHAS + Dependabot) |
| `POST /api/governance/deployment-decision` | Aprova ou nega deploys |
| `POST /api/governance/chat` | Chat livre sobre governança |
| `GET /health` | Health check |

## Como funciona

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│  Seu Workflow   │─────▶│  Governance API      │─────▶│  GitHub         │
│  (Actions)      │      │  (Copilot SDK)       │      │  Copilot        │
└─────────────────┘      └──────────────────────┘      └─────────────────┘
                                   │
                                   ▼
                         ┌──────────────────────┐
                         │  GitHub API          │
                         │  (PRs, Security,     │
                         │   Deployments)       │
                         └──────────────────────┘
```

1. Workflow chama a API
2. API busca dados do GitHub (arquivos, checks, alertas)
3. Copilot SDK analisa e retorna decisão
4. Workflow age com base na decisão

## Uso

### Local

```bash
npm install
npm run build
GITHUB_TOKEN=ghp_xxx npm start
```

### Testar

```bash
# Health
curl http://localhost:3000/health

# Analisar PR
curl -X POST http://localhost:3000/api/governance/analyze-pr \
  -H "Content-Type: application/json" \
  -d '{"owner":"org","repo":"repo","prNumber":123}'

# Scan de segurança
curl -X POST http://localhost:3000/api/governance/security-scan \
  -H "Content-Type: application/json" \
  -d '{"owner":"org","repo":"repo"}'

# Decisão de deploy
curl -X POST http://localhost:3000/api/governance/deployment-decision \
  -H "Content-Type: application/json" \
  -d '{"owner":"org","repo":"repo","environment":"production"}'
```

## Deploy no Azure

```bash
# Login
azd auth login

# Deploy (staging + production)
azd up
```

URL: `https://ca-governance-prod.azurecontainerapps.io`

## Integrar no seu repo

Adicione ao seu workflow:

```yaml
- name: Governance Check
  run: |
    RESULT=$(curl -s -X POST \
      -H "Content-Type: application/json" \
      -d '{"owner":"${{ github.repository_owner }}","repo":"${{ github.event.repository.name }}","prNumber":${{ github.event.pull_request.number }}}' \
      https://ca-governance-prod.azurecontainerapps.io/api/governance/analyze-pr)
    
    DECISION=$(echo "$RESULT" | jq -r '.recommendation')
    
    if [ "$DECISION" = "block" ]; then
      echo "❌ Bloqueado pela governança"
      exit 1
    fi
    
    echo "✅ Aprovado: $DECISION"
```

## Estrutura

```
src/
├── server/
│   ├── index.ts    # API endpoints
│   ├── tools.ts    # Ferramentas para Copilot SDK
│   └── prompts.ts  # System prompts
├── shared/
│   ├── telemetry.ts # OpenTelemetry
│   └── types.ts     # Tipos TypeScript
infra/
└── azure/          # Bicep para Container Apps
```

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `GITHUB_TOKEN` | Token com acesso ao repo |
| `PORT` | Porta do servidor (default: 3000) |

## Licença

MIT
