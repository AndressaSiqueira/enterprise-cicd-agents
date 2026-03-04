/**
 * Enterprise CI/CD Governance API Server
 * 
 * Powered by GitHub Copilot SDK - provides AI-driven governance decisions
 * for pull requests, security scanning, and deployment approvals.
 */

import express, { Request, Response, NextFunction } from 'express';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { Octokit } from '@octokit/rest';
import { trace } from '@opentelemetry/api';
import { initTelemetry } from '../shared/telemetry.js';
import { governanceTools } from './tools.js';
import { systemPrompt } from './prompts.js';

// Initialize telemetry
initTelemetry('governance-api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Initialize GitHub client
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Shared Copilot client
let copilotClient: CopilotClient | null = null;

async function getCopilotClient(): Promise<CopilotClient> {
  if (!copilotClient) {
    copilotClient = new CopilotClient({
      githubToken: GITHUB_TOKEN,
      autoStart: true
    });
    await copilotClient.start();
  }
  return copilotClient;
}

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    version: '1.0.0',
    features: ['pr-analysis', 'security-scan', 'deployment-decision']
  });
});

/**
 * POST /api/governance/chat
 * Interactive governance chat with AI
 */
app.post('/api/governance/chat', async (req: Request, res: Response, next: NextFunction) => {
  const tracer = trace.getTracer('governance-api');
  
  await tracer.startActiveSpan('governance-chat', async (span) => {
    try {
      const { message, context } = req.body;

      if (!message) {
        res.status(400).json({ error: 'Message is required' });
        span.end();
        return;
      }

      if (!GITHUB_TOKEN) {
        res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        span.end();
        return;
      }

      const client = await getCopilotClient();
      const session = await client.createSession({
        model: 'gpt-5',
        tools: governanceTools,
        systemMessage: { content: systemPrompt },
        onPermissionRequest: approveAll
      });

      const enrichedMessage = context 
        ? `Context: ${context.owner}/${context.repo}, PR #${context.prNumber || 'N/A'}\n\n${message}`
        : message;

      const response = await session.sendAndWait({ prompt: enrichedMessage });
      const content = response?.data?.content || '';

      res.json({ response: content, sessionId: session.sessionId });
      await session.destroy();
      span.end();
    } catch (error) {
      span.end();
      next(error);
    }
  });
});

/**
 * POST /api/governance/analyze-pr
 * Analyze a PR for governance decisions
 */
app.post('/api/governance/analyze-pr', async (req: Request, res: Response, next: NextFunction) => {
  const tracer = trace.getTracer('governance-api');
  
  await tracer.startActiveSpan('analyze-pr', async (span) => {
    try {
      const { owner, repo, prNumber } = req.body;

      if (!owner || !repo || !prNumber) {
        res.status(400).json({ error: 'owner, repo, and prNumber are required' });
        span.end();
        return;
      }

      if (!GITHUB_TOKEN) {
        res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        span.end();
        return;
      }

      // Fetch PR details from GitHub
      const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
      const { data: files } = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
      const { data: checks } = await octokit.checks.listForRef({ owner, repo, ref: pr.head.sha });

      // Categorize files
      const infraFiles = files.filter(f => 
        f.filename.includes('infra/') || f.filename.endsWith('.tf') || f.filename.endsWith('.bicep')
      );
      const securityFiles = files.filter(f =>
        f.filename.includes('security') || f.filename.includes('.env') || f.filename.includes('secret')
      );
      const testFiles = files.filter(f => f.filename.includes('.test.') || f.filename.includes('.spec.'));

      // AI analysis prompt
      const analysisPrompt = `
Analyze this Pull Request:

**PR:** ${pr.title} (#${prNumber})
**Author:** ${pr.user?.login}
**Branch:** ${pr.base.ref} <- ${pr.head.ref}
**Description:** ${pr.body || 'No description'}

**Files Changed (${files.length} total):**
- Infrastructure: ${infraFiles.length} files
- Security-related: ${securityFiles.length} files  
- Tests: ${testFiles.length} files

**CI Status:** ${checks.check_runs.filter(c => c.conclusion === 'success').length}/${checks.check_runs.length} passed

Provide:
1. Risk assessment (low/medium/high/critical)
2. Recommendation (approve/review/block)
3. Required actions before merge
`;

      const client = await getCopilotClient();
      const session = await client.createSession({
        model: 'gpt-5',
        tools: governanceTools,
        systemMessage: { content: systemPrompt },
        onPermissionRequest: approveAll
      });

      const response = await session.sendAndWait({ prompt: analysisPrompt });
      const content = response?.data?.content || '';

      const analysis = {
        pr: { number: prNumber, title: pr.title, author: pr.user?.login, url: pr.html_url },
        changes: { total: files.length, infrastructure: infraFiles.length, security: securityFiles.length, tests: testFiles.length },
        aiAnalysis: content,
        recommendation: determineRecommendation(content),
        timestamp: new Date().toISOString()
      };

      await session.destroy();
      res.json(analysis);
      span.end();
    } catch (error) {
      span.end();
      next(error);
    }
  });
});

/**
 * POST /api/governance/security-scan
 * Security analysis using GitHub security features
 */
app.post('/api/governance/security-scan', async (req: Request, res: Response, next: NextFunction) => {
  const tracer = trace.getTracer('governance-api');
  
  await tracer.startActiveSpan('security-scan', async (span) => {
    try {
      const { owner, repo, ref } = req.body;

      if (!owner || !repo) {
        res.status(400).json({ error: 'owner and repo are required' });
        span.end();
        return;
      }

      if (!GITHUB_TOKEN) {
        res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        span.end();
        return;
      }

      // Get security alerts from GitHub
      let codeAlerts: Array<{ rule: { id: string; severity: string }; state: string }> = [];
      let depAlerts: Array<{ security_vulnerability: { severity: string } }> = [];

      try {
        const { data } = await octokit.codeScanning.listAlertsForRepo({ owner, repo });
        codeAlerts = data as typeof codeAlerts;
      } catch { /* Code scanning may not be enabled */ }

      try {
        const { data } = await octokit.dependabot.listAlertsForRepo({ owner, repo });
        depAlerts = data as typeof depAlerts;
      } catch { /* Dependabot may not be enabled */ }

      const scanPrompt = `
Security analysis for ${owner}/${repo}:

**Code Scanning:** ${codeAlerts.length} alerts
${codeAlerts.slice(0, 5).map(a => `- ${a.rule.id}: ${a.rule.severity}`).join('\n') || 'None'}

**Dependencies:** ${depAlerts.length} alerts
${depAlerts.slice(0, 5).map(a => `- ${a.security_vulnerability.severity}`).join('\n') || 'None'}

Provide:
1. Security risk level
2. Critical issues to fix
3. Should deployment be blocked?
`;

      const client = await getCopilotClient();
      const session = await client.createSession({
        model: 'gpt-5',
        tools: governanceTools,
        systemMessage: { content: systemPrompt },
        onPermissionRequest: approveAll
      });

      const response = await session.sendAndWait({ prompt: scanPrompt });
      const content = response?.data?.content || '';

      const result = {
        repository: `${owner}/${repo}`,
        ref: ref || 'default',
        alerts: { codeScanning: codeAlerts.length, dependencies: depAlerts.length },
        aiAnalysis: content,
        shouldBlock: content.toLowerCase().includes('block'),
        timestamp: new Date().toISOString()
      };

      await session.destroy();
      res.json(result);
      span.end();
    } catch (error) {
      span.end();
      next(error);
    }
  });
});

/**
 * POST /api/governance/deployment-decision
 * AI-powered deployment approval
 */
app.post('/api/governance/deployment-decision', async (req: Request, res: Response, next: NextFunction) => {
  const tracer = trace.getTracer('governance-api');
  
  await tracer.startActiveSpan('deployment-decision', async (span) => {
    try {
      const { owner, repo, environment, sha, prNumber } = req.body;

      if (!owner || !repo || !environment) {
        res.status(400).json({ error: 'owner, repo, and environment are required' });
        span.end();
        return;
      }

      if (!GITHUB_TOKEN) {
        res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        span.end();
        return;
      }

      // Get deployment history
      const { data: deployments } = await octokit.repos.listDeployments({ 
        owner, repo, environment, per_page: 5 
      });

      // Get recent commits
      const { data: commits } = await octokit.repos.listCommits({
        owner, repo, sha: sha || undefined, per_page: 10
      });

      const decisionPrompt = `
Deployment request for ${owner}/${repo}:

**Environment:** ${environment}
**Commit:** ${sha || 'latest'}
**PR:** ${prNumber || 'N/A'}

**Recent Deployments:** ${deployments.length}
${deployments.slice(0, 3).map(d => `- ${d.created_at}`).join('\n') || 'None'}

**Recent Commits:**
${commits.slice(0, 5).map(c => `- ${c.sha.slice(0, 7)}: ${c.commit.message.split('\n')[0]}`).join('\n')}

Should this deployment to ${environment} be APPROVED or DENIED?
`;

      const client = await getCopilotClient();
      const session = await client.createSession({
        model: 'gpt-5',
        tools: governanceTools,
        systemMessage: { content: systemPrompt },
        onPermissionRequest: approveAll
      });

      const response = await session.sendAndWait({ prompt: decisionPrompt });
      const content = response?.data?.content || '';

      const decision = {
        repository: `${owner}/${repo}`,
        environment,
        sha: sha || commits[0]?.sha,
        decision: content.toUpperCase().includes('APPROVE') ? 'approve' : 'deny',
        requiresManualApproval: environment === 'production',
        aiAnalysis: content,
        timestamp: new Date().toISOString()
      };

      await session.destroy();
      res.json(decision);
      span.end();
    } catch (error) {
      span.end();
      next(error);
    }
  });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('API Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Helper
function determineRecommendation(content: string): 'approve' | 'review' | 'block' {
  const lower = content.toLowerCase();
  if (lower.includes('block') || lower.includes('critical') || lower.includes('deny')) return 'block';
  if (lower.includes('review') || lower.includes('high risk') || lower.includes('manual')) return 'review';
  return 'approve';
}

// Start server
app.listen(PORT, () => {
  console.log(`
🚀 Enterprise CI/CD Governance API

Endpoints:
  POST /api/governance/analyze-pr         - AI-powered PR analysis
  POST /api/governance/security-scan      - Security vulnerability check
  POST /api/governance/deployment-decision - Deployment approval
  POST /api/governance/chat               - Interactive governance chat
  GET  /health                            - Health check

Server running on port ${PORT}
`);
});

export default app;
