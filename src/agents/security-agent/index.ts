/**
 * Security Agent
 * Analyzes npm audit results and generates security intents
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  AgentIntent,
  Evidence,
  ActionType,
  Scope,
  getGitHubContext,
  withAgentSpan,
  logAgentActivity,
  initTelemetry,
} from '../../shared/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface VulnerabilityCounts {
  info: number;
  low: number;
  moderate: number;
  high: number;
  critical: number;
  total: number;
}

interface AuditResult {
  success: boolean;
  vulnerabilities: VulnerabilityCounts;
  advisories: AuditAdvisory[];
  rawOutput: string;
}

interface AuditAdvisory {
  id: number;
  severity: string;
  title: string;
  module_name: string;
  vulnerable_versions: string;
  recommendation: string;
}

/**
 * Run npm audit and parse results
 */
function runAudit(): AuditResult {
  let rawOutput = '';
  let auditData: Record<string, unknown> | null = null;

  try {
    rawOutput = execSync('npm audit --json 2>&1', {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    auditData = JSON.parse(rawOutput);
  } catch (error) {
    // npm audit exits with non-zero when vulnerabilities found
    if (error instanceof Error && 'stdout' in error) {
      rawOutput = (error as { stdout: string }).stdout || '';
      try {
        auditData = JSON.parse(rawOutput);
      } catch {
        // Could not parse JSON output
      }
    }
  }

  // Write raw audit output for artifacts
  const auditOutputPath = path.join(process.cwd(), 'audit.json');
  fs.writeFileSync(auditOutputPath, rawOutput || '{}');

  // Parse vulnerabilities
  const vulnerabilities: VulnerabilityCounts = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };

  const advisories: AuditAdvisory[] = [];

  if (auditData) {
    // npm audit v2 format
    const metadata = auditData.metadata as Record<string, unknown> | undefined;
    const vulns = metadata?.vulnerabilities as Record<string, number> | undefined;
    
    if (vulns) {
      vulnerabilities.info = vulns.info ?? 0;
      vulnerabilities.low = vulns.low ?? 0;
      vulnerabilities.moderate = vulns.moderate ?? 0;
      vulnerabilities.high = vulns.high ?? 0;
      vulnerabilities.critical = vulns.critical ?? 0;
      vulnerabilities.total = vulns.total ?? 0;
    }

    // Extract advisories if available
    const auditVulns = auditData.vulnerabilities as Record<string, Record<string, unknown>> | undefined;
    if (auditVulns) {
      for (const [name, vuln] of Object.entries(auditVulns)) {
        if (vuln.via && Array.isArray(vuln.via)) {
          for (const via of vuln.via) {
            if (typeof via === 'object' && via !== null) {
              advisories.push({
                id: (via as Record<string, unknown>).source as number ?? 0,
                severity: (via as Record<string, unknown>).severity as string ?? 'unknown',
                title: (via as Record<string, unknown>).title as string ?? name,
                module_name: name,
                vulnerable_versions: (via as Record<string, unknown>).range as string ?? '*',
                recommendation: (vuln.fixAvailable as boolean) ? 'Fix available' : 'No fix available',
              });
            }
          }
        }
      }
    }
  }

  const hasHighOrCritical = vulnerabilities.high > 0 || vulnerabilities.critical > 0;

  return {
    success: !hasHighOrCritical,
    vulnerabilities,
    advisories: advisories.slice(0, 10), // Limit to top 10
    rawOutput,
  };
}

/**
 * Determine action based on audit results
 */
function determineAction(result: AuditResult): ActionType {
  if (result.vulnerabilities.high > 0 || result.vulnerabilities.critical > 0) {
    return 'block_pr';
  }
  return 'approve_security';
}

/**
 * Build evidence from audit results
 */
function buildEvidence(result: AuditResult): Evidence[] {
  const ctx = getGitHubContext();
  const evidence: Evidence[] = [];

  evidence.push({
    type: 'git_context',
    source: 'github_context',
    summary: `Security scan for SHA: ${ctx.sha.substring(0, 8)}, Actor: ${ctx.actor}`,
    data: {
      sha: ctx.sha,
      ref: ctx.ref,
      actor: ctx.actor,
    },
  });

  evidence.push({
    type: 'audit_output',
    source: 'npm_audit',
    summary: `Found ${result.vulnerabilities.total} vulnerabilities (${result.vulnerabilities.critical} critical, ${result.vulnerabilities.high} high)`,
    data: {
      vulnerabilities: result.vulnerabilities,
      hasBlockingIssues: !result.success,
    },
  });

  if (result.advisories.length > 0) {
    evidence.push({
      type: 'audit_output',
      source: 'security_advisories',
      summary: `${result.advisories.length} security advisories found`,
      data: {
        advisories: result.advisories.map((a) => ({
          id: a.id,
          severity: a.severity,
          title: a.title,
          module: a.module_name,
        })),
      },
    });
  }

  return evidence;
}

/**
 * Main agent execution
 */
async function runSecurityAgent(): Promise<AgentIntent> {
  const ctx = getGitHubContext();

  return withAgentSpan('security-agent', 'analyze', ctx, async (span) => {
    logAgentActivity('security-agent', 'Starting security analysis');

    // Run audit
    span.addEvent('audit_started');
    const auditResult = runAudit();
    
    span.addEvent('audit_completed', {
      total: auditResult.vulnerabilities.total,
      critical: auditResult.vulnerabilities.critical,
      high: auditResult.vulnerabilities.high,
    });

    span.setAttribute('security.vulnerabilities_total', auditResult.vulnerabilities.total);
    span.setAttribute('security.vulnerabilities_critical', auditResult.vulnerabilities.critical);
    span.setAttribute('security.vulnerabilities_high', auditResult.vulnerabilities.high);

    logAgentActivity('security-agent', 'Audit completed', {
      total: auditResult.vulnerabilities.total,
      critical: auditResult.vulnerabilities.critical,
      high: auditResult.vulnerabilities.high,
    });

    // Determine action
    const action = determineAction(auditResult);
    const scope: Scope = 'test'; // Security checks always apply to test scope
    span.setAction(action, scope);

    // Build intent
    const intent: AgentIntent = {
      agent: 'security-agent',
      action,
      target: 'security',
      scope,
      timestamp: new Date().toISOString(),
      evidence: buildEvidence(auditResult),
      metadata: {
        vulnerabilities: auditResult.vulnerabilities,
        advisoriesCount: auditResult.advisories.length,
        blocking: !auditResult.success,
      },
    };

    logAgentActivity('security-agent', 'Analysis complete', {
      action: intent.action,
      scope: intent.scope,
      blocking: !auditResult.success,
    });

    return intent;
  });
}

/**
 * Write intent to file
 */
function writeIntent(intent: AgentIntent): void {
  const outputPath = path.join(__dirname, 'intent.json');
  fs.writeFileSync(outputPath, JSON.stringify(intent, null, 2));
  logAgentActivity('security-agent', `Intent written to ${outputPath}`);
}

// Main execution
async function main(): Promise<void> {
  initTelemetry();
  
  try {
    const intent = await runSecurityAgent();
    writeIntent(intent);
    console.log('\n=== Security Agent Intent ===');
    console.log(JSON.stringify(intent, null, 2));
  } catch (error) {
    console.error('Security Agent failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);

export { runSecurityAgent, runAudit };
