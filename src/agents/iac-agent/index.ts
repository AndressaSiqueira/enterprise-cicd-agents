/**
 * IaC Agent
 * Detects infrastructure changes and generates deployment intents
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

interface IaCAnalysis {
  infraChanged: boolean;
  prodChanged: boolean;
  changedFiles: string[];
  prodFiles: string[];
}

/**
 * Get diff based on event type (PR vs push)
 */
function getChangedFiles(): string[] {
  const ctx = getGitHubContext();
  let diffCommand: string;

  if (ctx.eventName === 'pull_request' && ctx.baseSha && ctx.headSha) {
    // For PRs, diff between base and head
    diffCommand = `git diff --name-only ${ctx.baseSha}..${ctx.headSha}`;
  } else if (ctx.eventName === 'push') {
    // For push events, diff with previous commit
    diffCommand = 'git diff --name-only HEAD~1..HEAD';
  } else {
    // Local development or unknown event - check uncommitted changes
    try {
      const uncommitted = execSync('git diff --name-only HEAD', { encoding: 'utf-8' }).trim();
      if (uncommitted) {
        return uncommitted.split('\n').filter(Boolean);
      }
      // If no uncommitted changes, check last commit
      diffCommand = 'git diff --name-only HEAD~1..HEAD';
    } catch {
      // Fallback: no git history
      logAgentActivity('iac-agent', 'No git history available, using fallback');
      return [];
    }
  }

  try {
    const output = execSync(diffCommand, { encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch (error) {
    logAgentActivity('iac-agent', 'Failed to get git diff', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Analyze changed files for IaC patterns
 */
function analyzeChanges(changedFiles: string[]): IaCAnalysis {
  const infraPatterns = [
    /^infra\//,
    /\.tf$/,
    /\.bicep$/,
    /terraform/,
    /cloudformation/,
    /\.arm\.json$/,
  ];

  const prodPatterns = [
    /^infra\/prod\//,
    /prod\.tf$/,
    /production\.(tf|bicep|json)$/,
    /prod[-_]?variables/,
    /\.prod\./,
  ];

  const infraFiles = changedFiles.filter((file) =>
    infraPatterns.some((pattern) => pattern.test(file))
  );

  const prodFiles = changedFiles.filter((file) =>
    prodPatterns.some((pattern) => pattern.test(file))
  );

  return {
    infraChanged: infraFiles.length > 0,
    prodChanged: prodFiles.length > 0,
    changedFiles: infraFiles,
    prodFiles,
  };
}

/**
 * Determine the appropriate action based on analysis
 */
function determineAction(analysis: IaCAnalysis): { action: ActionType; scope: Scope } {
  if (analysis.prodChanged) {
    // Production changes require apply_infra with prod scope (will be denied by policy)
    return { action: 'apply_infra', scope: 'prod' };
  }

  if (analysis.infraChanged) {
    // Non-prod infra changes trigger plan_infra in staging
    return { action: 'plan_infra', scope: 'staging' };
  }

  // No infra changes - default to verify
  return { action: 'verify_pipeline', scope: 'test' };
}

/**
 * Build evidence from analysis
 */
function buildEvidence(
  analysis: IaCAnalysis,
  allChangedFiles: string[]
): Evidence[] {
  const ctx = getGitHubContext();
  const evidence: Evidence[] = [];

  evidence.push({
    type: 'git_context',
    source: 'github_context',
    summary: `Event: ${ctx.eventName}, SHA: ${ctx.sha.substring(0, 8)}, Actor: ${ctx.actor}`,
    data: {
      sha: ctx.sha,
      ref: ctx.ref,
      eventName: ctx.eventName,
      actor: ctx.actor,
      repository: ctx.repository,
    },
  });

  evidence.push({
    type: 'changed_files',
    source: 'git_diff',
    summary: `${allChangedFiles.length} files changed, ${analysis.changedFiles.length} infra files`,
    data: {
      totalFiles: allChangedFiles.length,
      infraFiles: analysis.changedFiles,
      prodFiles: analysis.prodFiles,
    },
  });

  if (analysis.prodChanged) {
    evidence.push({
      type: 'changed_files',
      source: 'prod_detection',
      summary: `Production infra changes detected in ${analysis.prodFiles.length} files`,
      data: {
        files: analysis.prodFiles,
      },
    });
  }

  return evidence;
}

/**
 * Main agent execution
 */
async function runIaCAgent(): Promise<AgentIntent> {
  const ctx = getGitHubContext();

  return withAgentSpan('iac-agent', 'analyze', ctx, async (span) => {
    logAgentActivity('iac-agent', 'Starting IaC analysis');

    // Get changed files
    const allChangedFiles = getChangedFiles();
    span.setAttribute('files.total_changed', allChangedFiles.length);
    span.addEvent('files_retrieved', { count: allChangedFiles.length });

    // Analyze changes
    const analysis = analyzeChanges(allChangedFiles);
    span.setAttribute('infra.changed', analysis.infraChanged);
    span.setAttribute('infra.prod_changed', analysis.prodChanged);
    span.addEvent('analysis_complete', {
      infraFiles: analysis.changedFiles.length,
      prodFiles: analysis.prodFiles.length,
    });

    // Determine action
    const { action, scope } = determineAction(analysis);
    span.setAction(action, scope);

    // Build intent
    const intent: AgentIntent = {
      agent: 'iac-agent',
      action,
      target: 'infra',
      scope,
      timestamp: new Date().toISOString(),
      evidence: buildEvidence(analysis, allChangedFiles),
      metadata: {
        infraFilesCount: analysis.changedFiles.length,
        prodFilesCount: analysis.prodFiles.length,
        eventName: ctx.eventName,
      },
    };

    logAgentActivity('iac-agent', 'Analysis complete', {
      action: intent.action,
      scope: intent.scope,
      infraChanged: analysis.infraChanged,
      prodChanged: analysis.prodChanged,
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
  logAgentActivity('iac-agent', `Intent written to ${outputPath}`);
}

// Main execution
async function main(): Promise<void> {
  initTelemetry();
  
  try {
    const intent = await runIaCAgent();
    writeIntent(intent);
    console.log('\n=== IaC Agent Intent ===');
    console.log(JSON.stringify(intent, null, 2));
  } catch (error) {
    console.error('IaC Agent failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);

export { runIaCAgent, analyzeChanges, getChangedFiles };
