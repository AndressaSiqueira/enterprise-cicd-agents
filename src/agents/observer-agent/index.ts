/**
 * Observer Agent - Governance Control Plane
 * Evaluates all agent intents against policies and produces decisions
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import {
  AgentIntent,
  AgentDecision,
  Evidence,
  PoliciesConfig,
  PolicyRule,
  DecisionStatus,
  AgentName,
  Scope,
  computeIntentHash,
  getGitHubContext,
  withAgentSpan,
  logAgentActivity,
  initTelemetry,
} from '../../shared/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICIES_PATH = path.join(process.cwd(), 'policies', 'agent-policies.yaml');
const AGENTS_DIR = path.join(process.cwd(), 'src', 'agents');
const DECISIONS_DIR = path.join(__dirname, 'decisions');

interface EvaluationResult {
  decisions: AgentDecision[];
  summary: SummaryReport;
}

interface SummaryReport {
  timestamp: string;
  runId: string;
  sha: string;
  totalIntents: number;
  allowed: number;
  denied: number;
  conditional: number;
  overallStatus: 'pass' | 'fail' | 'pending_approval';
  decisions: DecisionSummary[];
}

interface DecisionSummary {
  agent: AgentName;
  action: string;
  scope: string;
  decision: DecisionStatus;
  reason: string;
}

/**
 * Load policies from YAML file
 */
function loadPolicies(): PoliciesConfig {
  try {
    const content = fs.readFileSync(POLICIES_PATH, 'utf-8');
    return parseYaml(content) as PoliciesConfig;
  } catch (error) {
    logAgentActivity('observer-agent', 'Failed to load policies', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`Failed to load policies: ${error}`);
  }
}

/**
 * Load all agent intents
 */
function loadIntents(): AgentIntent[] {
  const intents: AgentIntent[] = [];
  const agentDirs = ['iac-agent', 'cicd-agent', 'security-agent'];

  for (const agent of agentDirs) {
    const intentPath = path.join(AGENTS_DIR, agent, 'intent.json');
    try {
      if (fs.existsSync(intentPath)) {
        const content = fs.readFileSync(intentPath, 'utf-8');
        intents.push(JSON.parse(content) as AgentIntent);
        logAgentActivity('observer-agent', `Loaded intent from ${agent}`);
      } else {
        logAgentActivity('observer-agent', `No intent found for ${agent}`);
      }
    } catch (error) {
      logAgentActivity('observer-agent', `Failed to load intent from ${agent}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return intents;
}

/**
 * Check if scope matches rule scope condition
 */
function scopeMatches(intentScope: Scope, ruleScope: PolicyRule['scope']): boolean {
  if (!ruleScope || ruleScope === '*') {
    return true;
  }
  if (typeof ruleScope === 'object' && 'not' in ruleScope) {
    return intentScope !== ruleScope.not;
  }
  return intentScope === ruleScope;
}

/**
 * Find matching policy rule for an intent
 */
function findMatchingRule(
  intent: AgentIntent,
  policies: PoliciesConfig
): { rule: PolicyRule; ruleName: string } | null {
  // First check agent-specific policies
  const agentPolicy = policies[intent.agent as keyof PoliciesConfig];
  
  if (agentPolicy && 'rules' in agentPolicy) {
    for (let i = 0; i < agentPolicy.rules.length; i++) {
      const rule = agentPolicy.rules[i];
      const actionMatches = rule.action === '*' || rule.action === intent.action;
      const scopeMatch = scopeMatches(intent.scope, rule.scope);
      
      if (actionMatches && scopeMatch) {
        return {
          rule,
          ruleName: `${intent.agent}.rules[${i}]`,
        };
      }
    }
  }

  // Fall back to default policy
  if (policies.default && 'rules' in policies.default) {
    for (let i = 0; i < policies.default.rules.length; i++) {
      const rule = policies.default.rules[i];
      const actionMatches = rule.action === '*' || rule.action === intent.action;
      const scopeMatch = scopeMatches(intent.scope, rule.scope);
      
      if (actionMatches && scopeMatch) {
        return {
          rule,
          ruleName: `default.rules[${i}]`,
        };
      }
    }
  }

  return null;
}

/**
 * Evaluate a single intent against policies
 */
function evaluateIntent(
  intent: AgentIntent,
  policies: PoliciesConfig
): AgentDecision {
  const intentHash = computeIntentHash(intent);
  const matchResult = findMatchingRule(intent, policies);

  // Build evidence for decision
  const evidence: Evidence[] = [
    ...intent.evidence,
    {
      type: 'environment',
      source: 'observer-agent',
      summary: `Policy evaluation for ${intent.agent}:${intent.action}`,
      data: {
        intentHash,
        policyFile: POLICIES_PATH,
      },
    },
  ];

  if (!matchResult) {
    // No matching rule - conditional with human approval required
    return {
      intent_hash: intentHash,
      agent: intent.agent,
      action: intent.action,
      scope: intent.scope,
      decision: 'conditional',
      policy_rule_applied: 'none (unknown action/agent)',
      reason: 'No matching policy rule found. Human approval required.',
      timestamp: new Date().toISOString(),
      evidence,
      requires_approval: true,
    };
  }

  const { rule, ruleName } = matchResult;
  const reason = rule.reason || `Policy rule ${ruleName}: ${rule.decision}`;

  return {
    intent_hash: intentHash,
    agent: intent.agent,
    action: intent.action,
    scope: intent.scope,
    decision: rule.decision,
    policy_rule_applied: ruleName,
    reason,
    timestamp: new Date().toISOString(),
    evidence,
    requires_approval: rule.decision === 'conditional',
  };
}

/**
 * Generate markdown summary report
 */
function generateSummaryMarkdown(summary: SummaryReport): string {
  const statusEmoji = {
    pass: '✅',
    fail: '❌',
    pending_approval: '⏳',
  };

  let md = `# Agent Governance Summary\n\n`;
  md += `**Status:** ${statusEmoji[summary.overallStatus]} ${summary.overallStatus.toUpperCase()}\n\n`;
  md += `**Run ID:** ${summary.runId}\n`;
  md += `**SHA:** ${summary.sha}\n`;
  md += `**Timestamp:** ${summary.timestamp}\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Intents | ${summary.totalIntents} |\n`;
  md += `| Allowed | ${summary.allowed} |\n`;
  md += `| Denied | ${summary.denied} |\n`;
  md += `| Conditional | ${summary.conditional} |\n\n`;

  md += `## Decisions\n\n`;
  md += `| Agent | Action | Scope | Decision | Reason |\n`;
  md += `|-------|--------|-------|----------|--------|\n`;
  
  for (const d of summary.decisions) {
    const decisionEmoji = d.decision === 'allow' ? '✅' : d.decision === 'deny' ? '❌' : '⏳';
    md += `| ${d.agent} | ${d.action} | ${d.scope} | ${decisionEmoji} ${d.decision} | ${d.reason} |\n`;
  }

  md += `\n---\n`;
  md += `*Generated by Observer Agent*\n`;

  return md;
}

/**
 * Main observer agent execution
 */
async function runObserverAgent(): Promise<EvaluationResult> {
  const ctx = getGitHubContext();

  return withAgentSpan('observer-agent', 'evaluate', ctx, async (span) => {
    logAgentActivity('observer-agent', 'Starting policy evaluation');

    // Load policies
    const policies = loadPolicies();
    span.addEvent('policies_loaded');

    // Load intents
    const intents = loadIntents();
    span.setAttribute('intents.count', intents.length);
    span.addEvent('intents_loaded', { count: intents.length });

    // Ensure decisions directory exists
    if (!fs.existsSync(DECISIONS_DIR)) {
      fs.mkdirSync(DECISIONS_DIR, { recursive: true });
    }

    // Evaluate each intent
    const decisions: AgentDecision[] = [];
    
    for (const intent of intents) {
      const decision = evaluateIntent(intent, policies);
      decisions.push(decision);

      // Write individual decision file
      const decisionPath = path.join(DECISIONS_DIR, `${intent.agent}.decision.json`);
      fs.writeFileSync(decisionPath, JSON.stringify(decision, null, 2));

      logAgentActivity('observer-agent', `Evaluated ${intent.agent}`, {
        action: intent.action,
        scope: intent.scope,
        decision: decision.decision,
      });
    }

    // Compute summary
    const allowed = decisions.filter((d) => d.decision === 'allow').length;
    const denied = decisions.filter((d) => d.decision === 'deny').length;
    const conditional = decisions.filter((d) => d.decision === 'conditional').length;

    let overallStatus: 'pass' | 'fail' | 'pending_approval';
    if (denied > 0) {
      overallStatus = 'fail';
    } else if (conditional > 0) {
      overallStatus = 'pending_approval';
    } else {
      overallStatus = 'pass';
    }

    const summary: SummaryReport = {
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      sha: ctx.sha,
      totalIntents: intents.length,
      allowed,
      denied,
      conditional,
      overallStatus,
      decisions: decisions.map((d) => ({
        agent: d.agent,
        action: d.action,
        scope: d.scope,
        decision: d.decision,
        reason: d.reason,
      })),
    };

    // Write summary markdown
    const summaryMd = generateSummaryMarkdown(summary);
    fs.writeFileSync(path.join(__dirname, 'summary.md'), summaryMd);

    span.setAttribute('evaluation.allowed', allowed);
    span.setAttribute('evaluation.denied', denied);
    span.setAttribute('evaluation.conditional', conditional);
    span.setAttribute('evaluation.overall_status', overallStatus);

    logAgentActivity('observer-agent', 'Evaluation complete', {
      totalIntents: intents.length,
      allowed,
      denied,
      conditional,
      overallStatus,
    });

    return { decisions, summary };
  });
}

/**
 * Check if any decision requires blocking the workflow
 */
function shouldBlockWorkflow(decisions: AgentDecision[]): boolean {
  return decisions.some((d) => d.decision === 'deny' || d.decision === 'conditional');
}

// Main execution
async function main(): Promise<void> {
  initTelemetry();
  
  try {
    const { decisions, summary } = await runObserverAgent();
    
    console.log('\n=== Observer Agent Summary ===');
    console.log(`Status: ${summary.overallStatus}`);
    console.log(`Allowed: ${summary.allowed}, Denied: ${summary.denied}, Conditional: ${summary.conditional}`);
    console.log('\nDecisions:');
    
    for (const d of decisions) {
      console.log(`  ${d.agent}: ${d.action} => ${d.decision} (${d.reason})`);
    }

    // Output for GitHub Actions
    const shouldBlock = shouldBlockWorkflow(decisions);
    console.log(`\n::set-output name=should_block::${shouldBlock}`);
    console.log(`::set-output name=overall_status::${summary.overallStatus}`);

    // Write status for workflow consumption
    fs.writeFileSync(
      path.join(__dirname, 'status.json'),
      JSON.stringify({
        shouldBlock,
        overallStatus: summary.overallStatus,
        denied: summary.denied,
        conditional: summary.conditional,
      }, null, 2)
    );

    if (shouldBlock) {
      console.log('\n⚠️  Workflow should be blocked due to denied or conditional decisions');
    }
  } catch (error) {
    console.error('Observer Agent failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);

export { runObserverAgent, evaluateIntent, loadPolicies, loadIntents };
