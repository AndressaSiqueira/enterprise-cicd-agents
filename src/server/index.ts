/**
 * Enterprise CI/CD Governance API Server
 * 
 * Powered by GitHub Copilot SDK - provides AI-driven governance decisions
 * for pull requests, security scanning, and deployment approvals.
 */

import express, { Request, Response, NextFunction } from 'express';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { Octokit } from '@octokit/rest';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { initTelemetry } from '../shared/telemetry.js';
import { governanceTools } from './tools.js';
import { systemPrompt } from './prompts.js';
import { DependencyService } from '../integrations/dependency-service.js';

// Initialize telemetry
initTelemetry('governance-api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Initialize clients
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Shared Copilot client (reusable across requests)
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

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    version: '1.0.0',
    features: ['pr-analysis', 'security-scan', 'deployment-governance']
  });
});

// Main governance chat endpoint
app.post('/api/governance/chat', async (req: Request, res: Response, next: NextFunction) => {
  const tracer = trace.getTracer('governance-api');
  
  await tracer.startActiveSpan('governance-chat', async (span) => {
    try {
      const { message, context } = req.body;

      if (!message) {
        res.status(400).json({ error: 'Message is required' });
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing message' });
        span.end();
        return;
      }

      if (!GITHUB_TOKEN) {
        res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing token' });
        span.end();
        return;
      }

      span.setAttribute('message.length', message.length);
      span.setAttribute('context.repo', context?.repo || 'unknown');

      // Get Copilot client and create session
      const client = await getCopilotClient();
      const session = await client.createSession({
        model: 'gpt-5',
        tools: governanceTools,
        systemMessage: {
          content: systemPrompt
        },
        onPermissionRequest: approveAll
      });

      // Build context-enriched message
      const enrichedMessage = context 
        ? `Context: Repository ${context.owner}/${context.repo}, PR #${context.prNumber || 'N/A'}, Branch: ${context.branch || 'unknown'}\n\nUser Request: ${message}`
        : message;

      // Get AI response with tool execution
      const response = await session.sendAndWait({ prompt: enrichedMessage });

      const content = response?.data?.content || '';
      span.setAttribute('response.length', content.length);
      span.setStatus({ code: SpanStatusCode.OK });

      res.json({
        response: content,
        sessionId: session.sessionId
      });

      await session.destroy();
      span.end();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      span.end();
      next(error);
    }
  });
});

// PR Analysis endpoint - specialized for CI integration
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

      span.setAttribute('pr.owner', owner);
      span.setAttribute('pr.repo', repo);
      span.setAttribute('pr.number', prNumber);

      if (!GITHUB_TOKEN) {
        res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        span.end();
        return;
      }

      // Fetch PR details
      const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
      const { data: files } = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
      const { data: checks } = await octokit.checks.listForRef({ owner, repo, ref: pr.head.sha });

      // Categorize changes
      const infraFiles = files.filter(f => 
        f.filename.includes('infra/') || 
        f.filename.endsWith('.tf') || 
        f.filename.endsWith('.bicep')
      );
      const securityFiles = files.filter(f =>
        f.filename.includes('security') ||
        f.filename.includes('.env') ||
        f.filename.includes('secret')
      );
      const testFiles = files.filter(f => f.filename.includes('.test.') || f.filename.includes('.spec.'));

      // Create analysis prompt
      const analysisPrompt = `
Analyze this Pull Request for governance decisions:

PR: ${pr.title} (#${prNumber})
Author: ${pr.user?.login}
Base: ${pr.base.ref} <- Head: ${pr.head.ref}
Description: ${pr.body || 'No description'}

Files Changed (${files.length} total):
- Infrastructure files: ${infraFiles.length} (${infraFiles.map(f => f.filename).join(', ') || 'none'})
- Security-related files: ${securityFiles.length} (${securityFiles.map(f => f.filename).join(', ') || 'none'})
- Test files: ${testFiles.length}
- Other files: ${files.length - infraFiles.length - securityFiles.length - testFiles.length}

CI Status: ${checks.check_runs.length} checks, ${checks.check_runs.filter(c => c.conclusion === 'success').length} passed

Provide:
1. Risk assessment (low/medium/high/critical)
2. Governance recommendation (approve/review/block)
3. Required actions before merge
4. Security concerns if any
`;

      // Get AI analysis
      const client = await getCopilotClient();
      const session = await client.createSession({
        model: 'gpt-5',
        tools: governanceTools,
        systemMessage: {
          content: systemPrompt
        },
        onPermissionRequest: approveAll
      });

      const response = await session.sendAndWait({ prompt: analysisPrompt });
      const content = response?.data?.content || '';

      // Determine action based on analysis
      const analysis = {
        pr: {
          number: prNumber,
          title: pr.title,
          author: pr.user?.login,
          url: pr.html_url
        },
        changes: {
          total: files.length,
          infrastructure: infraFiles.length,
          security: securityFiles.length,
          tests: testFiles.length
        },
        aiAnalysis: content,
        recommendation: determineRecommendation(content),
        timestamp: new Date().toISOString()
      };

      await session.destroy();
      span.setAttribute('analysis.recommendation', analysis.recommendation);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      res.json(analysis);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      span.end();
      next(error);
    }
  });
});

// Security scan endpoint
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

      // Get code scanning alerts if available
      let securityAlerts: Array<{ rule: { id: string; severity: string }; state: string }> = [];
      try {
        const { data } = await octokit.codeScanning.listAlertsForRepo({ owner, repo });
        securityAlerts = data as typeof securityAlerts;
      } catch {
        // Code scanning may not be enabled
      }

      // Get dependency alerts
      let dependencyAlerts: Array<{ security_vulnerability: { severity: string } }> = [];
      try {
        const { data } = await octokit.dependabot.listAlertsForRepo({ owner, repo });
        dependencyAlerts = data as typeof dependencyAlerts;
      } catch {
        // Dependabot may not be enabled
      }

      const scanPrompt = `
Analyze security posture for ${owner}/${repo}:

Code Scanning Alerts: ${securityAlerts.length}
${securityAlerts.slice(0, 5).map(a => `- ${a.rule.id}: ${a.rule.severity} (${a.state})`).join('\n') || 'No alerts or scanning not enabled'}

Dependency Alerts: ${dependencyAlerts.length}
${dependencyAlerts.slice(0, 5).map(a => `- Severity: ${a.security_vulnerability.severity}`).join('\n') || 'No alerts or Dependabot not enabled'}

Provide:
1. Overall security risk level
2. Critical issues to address
3. Recommended remediation steps
4. Should deployment be blocked? (yes/no with reason)
`;

      const client = await getCopilotClient();
      const session = await client.createSession({
        model: 'gpt-5',
        tools: governanceTools,
        systemMessage: {
          content: systemPrompt
        },
        onPermissionRequest: approveAll
      });

      const response = await session.sendAndWait({ prompt: scanPrompt });
      const content = response?.data?.content || '';

      const result = {
        repository: `${owner}/${repo}`,
        ref: ref || 'default',
        alerts: {
          codeScanning: securityAlerts.length,
          dependencies: dependencyAlerts.length
        },
        aiAnalysis: content,
        shouldBlock: content.toLowerCase().includes('block'),
        timestamp: new Date().toISOString()
      };

      await session.destroy();
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      span.end();
      next(error);
    }
  });
});

// Deployment decision endpoint
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
        owner, 
        repo, 
        environment,
        per_page: 5 
      });

      // Get recent commits
      const { data: commits } = await octokit.repos.listCommits({
        owner,
        repo,
        sha: sha || undefined,
        per_page: 10
      });

      const decisionPrompt = `
Evaluate deployment request for ${owner}/${repo}:

Target Environment: ${environment}
Commit SHA: ${sha || 'latest'}
PR Number: ${prNumber || 'N/A'}

Recent Deployments to ${environment}: ${deployments.length}
${deployments.slice(0, 3).map(d => `- ${d.created_at}: ${d.description || 'No description'}`).join('\n') || 'No recent deployments'}

Recent Commits:
${commits.slice(0, 5).map(c => `- ${c.sha.slice(0, 7)}: ${c.commit.message.split('\n')[0]}`).join('\n')}

Based on enterprise deployment policies:
1. Is this deployment safe for ${environment}?
2. What pre-deployment checks are recommended?
3. Should this require manual approval?
4. Rollback strategy recommendation

Provide a clear APPROVE or DENY decision with justification.
`;

      const client = await getCopilotClient();
      const session = await client.createSession({
        model: 'gpt-5',
        tools: governanceTools,
        systemMessage: {
          content: systemPrompt
        },
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
      span.setAttribute('decision.result', decision.decision);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      res.json(decision);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      span.end();
      next(error);
    }
  });
});

// Multi-repo governance check endpoint
app.post('/api/governance/multi-repo-check', async (req: Request, res: Response, next: NextFunction) => {
  const tracer = trace.getTracer('governance-api');
  
  await tracer.startActiveSpan('multi-repo-check', async (span) => {
    try {
      const { owner, repo, action } = req.body;

      if (!owner || !repo || !action) {
        res.status(400).json({ error: 'owner, repo, and action are required' });
        span.end();
        return;
      }

      if (!['deploy', 'merge', 'release'].includes(action)) {
        res.status(400).json({ error: 'action must be one of: deploy, merge, release' });
        span.end();
        return;
      }

      if (!GITHUB_TOKEN) {
        res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        span.end();
        return;
      }

      span.setAttribute('repo', `${owner}/${repo}`);
      span.setAttribute('action', action);

      // Initialize dependency service and check multi-repo status
      const dependencyService = new DependencyService(GITHUB_TOKEN);
      const checkResult = await dependencyService.checkMultiRepo(owner, repo, action);

      // Generate summary for AI analysis
      const aiPrompt = dependencyService.generateSummaryForAI(checkResult);

      // Get AI analysis using Copilot SDK
      const client = await getCopilotClient();
      const session = await client.createSession({
        model: 'gpt-5',
        tools: governanceTools,
        systemMessage: {
          content: systemPrompt
        },
        onPermissionRequest: approveAll
      });

      const response = await session.sendAndWait({ prompt: aiPrompt });
      const aiAnalysis = response?.data?.content || '';

      const result = {
        ...checkResult,
        aiAnalysis
      };

      await session.destroy();
      span.setAttribute('decision', result.decision);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
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

// Helper function
function determineRecommendation(content: string): 'approve' | 'review' | 'block' {
  const lower = content.toLowerCase();
  if (lower.includes('block') || lower.includes('critical') || lower.includes('deny')) {
    return 'block';
  }
  if (lower.includes('review') || lower.includes('high risk') || lower.includes('manual')) {
    return 'review';
  }
  return 'approve';
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Enterprise CI/CD Governance API running on port ${PORT}`);
  console.log(`📊 Endpoints available:`);
  console.log(`   POST /api/governance/chat - Interactive governance chat`);
  console.log(`   POST /api/governance/analyze-pr - PR analysis`);
  console.log(`   POST /api/governance/security-scan - Security scanning`);
  console.log(`   POST /api/governance/deployment-decision - Deployment approval`);
  console.log(`   POST /api/governance/multi-repo-check - Multi-repo governance`);
  console.log(`   GET  /health - Health check`);
});

export default app;
