/**
 * MCP Server for Enterprise CI/CD Governance
 * 
 * Exposes governance tools as MCP tools that can be used by
 * AI assistants like GitHub Copilot to analyze PRs, scan security,
 * and make deployment decisions.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Initialize Octokit if token available
const octokit = GITHUB_TOKEN ? new Octokit({ auth: GITHUB_TOKEN }) : null;

// Create MCP server
const server = new Server(
  {
    name: 'enterprise-cicd-governance',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define MCP tools
const mcpTools: Tool[] = [
  {
    name: 'analyze_pull_request',
    description: 'Analyze a GitHub pull request for governance decisions. Returns risk assessment, policy compliance, and recommended actions.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (username or organization)',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        prNumber: {
          type: 'number',
          description: 'Pull request number',
        },
      },
      required: ['owner', 'repo', 'prNumber'],
    },
  },
  {
    name: 'check_security_vulnerabilities',
    description: 'Check for security vulnerabilities in a repository using npm audit and GitHub security features.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        runLocalAudit: {
          type: 'boolean',
          description: 'Whether to run npm audit locally (requires npm)',
          default: true,
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'evaluate_deployment_readiness',
    description: 'Evaluate if a deployment is ready to proceed based on tests, security, and policy compliance.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        environment: {
          type: 'string',
          description: 'Target environment (development, staging, production)',
          enum: ['development', 'staging', 'production'],
        },
        sha: {
          type: 'string',
          description: 'Git commit SHA to deploy (optional, defaults to latest)',
        },
      },
      required: ['owner', 'repo', 'environment'],
    },
  },
  {
    name: 'get_infrastructure_changes',
    description: 'Detect infrastructure-as-code changes between two commits or branches.',
    inputSchema: {
      type: 'object',
      properties: {
        baseBranch: {
          type: 'string',
          description: 'Base branch or commit SHA',
          default: 'main',
        },
        headBranch: {
          type: 'string',
          description: 'Head branch or commit SHA',
          default: 'HEAD',
        },
      },
    },
  },
  {
    name: 'generate_governance_report',
    description: 'Generate a comprehensive governance report for a PR or deployment, suitable for posting as a PR comment.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        prNumber: {
          type: 'number',
          description: 'Pull request number (optional)',
        },
        includeSecurityScan: {
          type: 'boolean',
          description: 'Include security vulnerability scan',
          default: true,
        },
        includeTestResults: {
          type: 'boolean',
          description: 'Include test result analysis',
          default: true,
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'check_policy_compliance',
    description: 'Check if a change complies with enterprise governance policies.',
    inputSchema: {
      type: 'object',
      properties: {
        changeType: {
          type: 'string',
          description: 'Type of change',
          enum: ['infrastructure', 'security', 'application', 'configuration'],
        },
        targetEnvironment: {
          type: 'string',
          description: 'Target environment',
          enum: ['development', 'staging', 'production'],
        },
        filesChanged: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of changed file paths',
        },
      },
      required: ['changeType', 'targetEnvironment'],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: mcpTools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'analyze_pull_request':
        return await analyzePullRequest(args as { owner: string; repo: string; prNumber: number });

      case 'check_security_vulnerabilities':
        return await checkSecurityVulnerabilities(args as { owner: string; repo: string; runLocalAudit?: boolean });

      case 'evaluate_deployment_readiness':
        return await evaluateDeploymentReadiness(args as { owner: string; repo: string; environment: string; sha?: string });

      case 'get_infrastructure_changes':
        return await getInfrastructureChanges(args as { baseBranch?: string; headBranch?: string });

      case 'generate_governance_report':
        return await generateGovernanceReport(args as { owner: string; repo: string; prNumber?: number; includeSecurityScan?: boolean; includeTestResults?: boolean });

      case 'check_policy_compliance':
        return await checkPolicyCompliance(args as { changeType: string; targetEnvironment: string; filesChanged?: string[] });

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error executing ${name}: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Tool implementations
async function analyzePullRequest(args: { owner: string; repo: string; prNumber: number }) {
  if (!octokit) {
    return {
      content: [{ type: 'text', text: 'GITHUB_TOKEN not configured. Cannot analyze PR.' }],
      isError: true,
    };
  }

  const { owner, repo, prNumber } = args;

  // Fetch PR details
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  const { data: files } = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
  const { data: reviews } = await octokit.pulls.listReviews({ owner, repo, pull_number: prNumber });

  // Categorize files
  const infraFiles = files.filter(f => /infra\/|\.tf$|\.bicep$/i.test(f.filename));
  const securityFiles = files.filter(f => /security|\.env|secret|auth/i.test(f.filename));
  const testFiles = files.filter(f => /\.test\.|\.spec\./i.test(f.filename));

  // Calculate risk
  let riskLevel = 'low';
  const risks: string[] = [];

  if (infraFiles.length > 0) {
    riskLevel = 'medium';
    risks.push(`${infraFiles.length} infrastructure file(s) changed`);
  }
  if (securityFiles.length > 0) {
    riskLevel = 'high';
    risks.push(`${securityFiles.length} security-related file(s) changed`);
  }
  if (infraFiles.some(f => /prod/i.test(f.filename))) {
    riskLevel = 'critical';
    risks.push('Production infrastructure changes detected');
  }

  // Check approvals
  const approvals = reviews.filter(r => r.state === 'APPROVED').length;
  const requiredApprovals = riskLevel === 'high' || riskLevel === 'critical' ? 2 : 1;

  const analysis = {
    pr: {
      number: prNumber,
      title: pr.title,
      author: pr.user?.login,
      state: pr.state,
      url: pr.html_url,
    },
    changes: {
      total: files.length,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      infrastructure: infraFiles.map(f => f.filename),
      security: securityFiles.map(f => f.filename),
      tests: testFiles.length,
    },
    governance: {
      riskLevel,
      risks,
      approvals,
      requiredApprovals,
      meetsApprovalRequirement: approvals >= requiredApprovals,
      recommendation: approvals >= requiredApprovals && riskLevel !== 'critical' ? 'APPROVE' : riskLevel === 'critical' ? 'BLOCK' : 'REVIEW',
    },
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(analysis, null, 2),
      },
    ],
  };
}

async function checkSecurityVulnerabilities(args: { owner: string; repo: string; runLocalAudit?: boolean }) {
  const results: {
    npmAudit: { vulnerabilities: Record<string, number> } | null;
    githubAlerts: { codeScanning: number; dependabot: number };
    riskLevel: string;
    recommendation: string;
  } = {
    npmAudit: null,
    githubAlerts: { codeScanning: 0, dependabot: 0 },
    riskLevel: 'low',
    recommendation: 'APPROVE',
  };

  // Run local npm audit if requested
  if (args.runLocalAudit !== false) {
    try {
      const auditOutput = execSync('npm audit --json 2>/dev/null || true', { encoding: 'utf-8' });
      const audit = JSON.parse(auditOutput || '{}');
      results.npmAudit = {
        vulnerabilities: audit.metadata?.vulnerabilities || {},
      };

      if (audit.metadata?.vulnerabilities?.critical > 0) {
        results.riskLevel = 'critical';
        results.recommendation = 'BLOCK';
      } else if (audit.metadata?.vulnerabilities?.high > 0) {
        results.riskLevel = 'high';
        results.recommendation = 'REVIEW';
      }
    } catch {
      // npm audit failed or not available
    }
  }

  // Get GitHub security alerts if token available
  if (octokit) {
    try {
      const { data: codeAlerts } = await octokit.codeScanning.listAlertsForRepo({
        owner: args.owner,
        repo: args.repo,
        state: 'open',
      });
      results.githubAlerts.codeScanning = codeAlerts.length;
    } catch {
      // Code scanning may not be enabled
    }

    try {
      const { data: depAlerts } = await octokit.dependabot.listAlertsForRepo({
        owner: args.owner,
        repo: args.repo,
        state: 'open',
      });
      results.githubAlerts.dependabot = depAlerts.length;
    } catch {
      // Dependabot may not be enabled
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
  };
}

async function evaluateDeploymentReadiness(args: { owner: string; repo: string; environment: string; sha?: string }) {
  const checklist: Array<{ check: string; passed: boolean; required: boolean }> = [];
  let ready = true;

  // Check recent commits
  if (octokit) {
    try {
      const { data: checks } = await octokit.checks.listForRef({
        owner: args.owner,
        repo: args.repo,
        ref: args.sha || 'main',
      });

      const allPassed = checks.check_runs.every(c => c.conclusion === 'success');
      checklist.push({ check: 'CI checks passed', passed: allPassed, required: true });
      if (!allPassed) ready = false;
    } catch {
      checklist.push({ check: 'CI checks passed', passed: false, required: true });
      ready = false;
    }
  }

  // Environment-specific checks
  if (args.environment === 'production') {
    checklist.push(
      { check: 'Staging deployment verified', passed: false, required: true },
      { check: 'Manual approval obtained', passed: false, required: true },
      { check: 'Rollback plan documented', passed: false, required: true }
    );
    ready = false; // Production always requires manual verification
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          environment: args.environment,
          sha: args.sha || 'latest',
          ready,
          checklist,
          recommendation: ready ? 'PROCEED' : 'WAIT',
        }, null, 2),
      },
    ],
  };
}

async function getInfrastructureChanges(args: { baseBranch?: string; headBranch?: string }) {
  const base = args.baseBranch || 'main';
  const head = args.headBranch || 'HEAD';

  try {
    const diffOutput = execSync(`git diff --name-only ${base}...${head} 2>/dev/null || git diff --name-only ${base} ${head}`, {
      encoding: 'utf-8',
    });

    const allFiles = diffOutput.trim().split('\n').filter(Boolean);
    const infraFiles = allFiles.filter(f => /infra\/|\.tf$|\.bicep$|\.yaml$|\.yml$/i.test(f));
    const prodFiles = infraFiles.filter(f => /prod/i.test(f));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            totalChanges: allFiles.length,
            infrastructureChanges: infraFiles.length,
            productionChanges: prodFiles.length,
            files: {
              all: allFiles,
              infrastructure: infraFiles,
              production: prodFiles,
            },
            riskLevel: prodFiles.length > 0 ? 'high' : infraFiles.length > 0 ? 'medium' : 'low',
          }, null, 2),
        },
      ],
    };
  } catch {
    return {
      content: [{ type: 'text', text: 'Unable to get git diff. Ensure you are in a git repository.' }],
      isError: true,
    };
  }
}

async function generateGovernanceReport(args: { owner: string; repo: string; prNumber?: number; includeSecurityScan?: boolean; includeTestResults?: boolean }) {
  let report = `# 🏛️ Governance Report\n\n`;
  report += `**Repository:** ${args.owner}/${args.repo}\n`;
  report += `**Generated:** ${new Date().toISOString()}\n\n`;

  // PR Analysis
  if (args.prNumber && octokit) {
    const prAnalysis = await analyzePullRequest({ owner: args.owner, repo: args.repo, prNumber: args.prNumber });
    const prData = JSON.parse((prAnalysis.content[0] as { text: string }).text);

    report += `## 📋 Pull Request Analysis\n\n`;
    report += `- **PR:** #${prData.pr.number} - ${prData.pr.title}\n`;
    report += `- **Risk Level:** ${prData.governance.riskLevel.toUpperCase()}\n`;
    report += `- **Recommendation:** ${prData.governance.recommendation}\n`;
    report += `- **Approvals:** ${prData.governance.approvals}/${prData.governance.requiredApprovals}\n\n`;

    if (prData.governance.risks.length > 0) {
      report += `### Risks Identified\n${prData.governance.risks.map((r: string) => `- ⚠️ ${r}`).join('\n')}\n\n`;
    }
  }

  // Security scan
  if (args.includeSecurityScan !== false) {
    const securityResult = await checkSecurityVulnerabilities({ owner: args.owner, repo: args.repo });
    const secData = JSON.parse((securityResult.content[0] as { text: string }).text);

    report += `## 🔒 Security Scan\n\n`;
    report += `- **Risk Level:** ${secData.riskLevel.toUpperCase()}\n`;
    report += `- **Recommendation:** ${secData.recommendation}\n`;

    if (secData.npmAudit) {
      const vulns = secData.npmAudit.vulnerabilities;
      report += `- **Vulnerabilities:** Critical: ${vulns.critical || 0}, High: ${vulns.high || 0}, Medium: ${vulns.moderate || 0}\n`;
    }
    report += '\n';
  }

  report += `---\n*Report generated by Enterprise CI/CD Governance Agent*`;

  return {
    content: [{ type: 'text', text: report }],
  };
}

async function checkPolicyCompliance(args: { changeType: string; targetEnvironment: string; filesChanged?: string[] }) {
  const policies: Record<string, Record<string, { requiresApproval: boolean; minReviewers: number; requiresSecurityReview: boolean }>> = {
    infrastructure: {
      production: { requiresApproval: true, minReviewers: 2, requiresSecurityReview: true },
      staging: { requiresApproval: true, minReviewers: 1, requiresSecurityReview: false },
      development: { requiresApproval: false, minReviewers: 0, requiresSecurityReview: false },
    },
    security: {
      production: { requiresApproval: true, minReviewers: 2, requiresSecurityReview: true },
      staging: { requiresApproval: true, minReviewers: 2, requiresSecurityReview: true },
      development: { requiresApproval: true, minReviewers: 1, requiresSecurityReview: true },
    },
    application: {
      production: { requiresApproval: true, minReviewers: 1, requiresSecurityReview: false },
      staging: { requiresApproval: false, minReviewers: 0, requiresSecurityReview: false },
      development: { requiresApproval: false, minReviewers: 0, requiresSecurityReview: false },
    },
    configuration: {
      production: { requiresApproval: true, minReviewers: 2, requiresSecurityReview: true },
      staging: { requiresApproval: true, minReviewers: 1, requiresSecurityReview: false },
      development: { requiresApproval: false, minReviewers: 0, requiresSecurityReview: false },
    },
  };

  const policy = policies[args.changeType]?.[args.targetEnvironment];

  if (!policy) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            compliant: false,
            error: `Unknown change type '${args.changeType}' or environment '${args.targetEnvironment}'`,
          }, null, 2),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          changeType: args.changeType,
          environment: args.targetEnvironment,
          policy,
          filesAnalyzed: args.filesChanged?.length || 0,
        }, null, 2),
      },
    ],
  };
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Enterprise CI/CD Governance MCP Server running...');
}

main().catch(console.error);
