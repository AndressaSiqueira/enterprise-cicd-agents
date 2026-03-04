/**
 * Webhook Handler Example
 * 
 * This is a sample implementation showing how to receive GitHub webhooks
 * and call the Governance SDK API for automated PR analysis.
 * 
 * Deploy this as a separate service or Azure Function to automate
 * governance checks whenever a PR is opened or updated.
 */

import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

// Configuration
const GOVERNANCE_API_URL = process.env.GOVERNANCE_API_URL || 'https://ca-governance-prod.azurecontainerapps.io';
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

/**
 * Verify GitHub webhook signature
 */
function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!GITHUB_WEBHOOK_SECRET || !signature) return false;
  
  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

/**
 * Call Governance API for PR analysis
 */
async function analyzeWithGovernance(owner: string, repo: string, prNumber: number) {
  const response = await fetch(`${GOVERNANCE_API_URL}/api/governance/analyze-pr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
    },
    body: JSON.stringify({ owner, repo, prNumber }),
  });

  if (!response.ok) {
    throw new Error(`Governance API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Post comment on PR with governance results
 */
async function postPRComment(owner: string, repo: string, prNumber: number, result: any) {
  const emoji = result.decision === 'APPROVE' ? '✅' : result.decision === 'DENY' ? '❌' : '⏳';
  
  const body = `## 🤖 AI Governance Analysis

| Metric | Value |
|--------|-------|
| **Decision** | ${emoji} ${result.decision} |
| **Risk Level** | ${result.riskLevel} |

### Summary
${result.summary}

---
*Automated analysis by Governance SDK*`;

  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ body }),
  });
}

/**
 * GitHub webhook endpoint
 */
app.post('/webhook', async (req, res) => {
  // Verify signature
  const signature = req.headers['x-hub-signature-256'] as string;
  if (!verifySignature(JSON.stringify(req.body), signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'] as string;
  const payload = req.body;

  console.log(`Received ${event} event`);

  // Handle pull_request events
  if (event === 'pull_request') {
    const action = payload.action;
    const pr = payload.pull_request;
    const repo = payload.repository;

    // Only analyze on open, synchronize, or reopened
    if (['opened', 'synchronize', 'reopened'].includes(action)) {
      console.log(`Analyzing PR #${pr.number} in ${repo.full_name}`);

      try {
        const result = await analyzeWithGovernance(
          repo.owner.login,
          repo.name,
          pr.number
        );

        console.log(`Governance result: ${result.decision}`);

        // Post comment with results
        await postPRComment(repo.owner.login, repo.name, pr.number, result);

        // If DENY, you could also add a check status or label

        return res.json({ status: 'analyzed', result });
      } catch (error) {
        console.error('Analysis failed:', error);
        return res.status(500).json({ error: 'Analysis failed' });
      }
    }
  }

  res.json({ status: 'ignored' });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Webhook handler listening on port ${PORT}`);
});

export { app };
