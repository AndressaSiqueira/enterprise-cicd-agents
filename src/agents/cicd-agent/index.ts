/**
 * CI/CD Agent
 * Analyzes test results and generates pipeline intents
 */

import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
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

interface TestResults {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  duration: number;
  testSuites: {
    total: number;
    passed: number;
    failed: number;
  };
  rawOutput?: string;
  errorOutput?: string;
}

/**
 * Determine scope from branch/ref
 */
function determineScope(): Scope {
  const ctx = getGitHubContext();
  const ref = ctx.ref.toLowerCase();

  if (ref.includes('main') || ref.includes('master')) {
    return 'staging'; // Main branch deploys to staging first
  }
  if (ref.includes('prod') || ref.includes('release')) {
    return 'prod';
  }
  return 'test';
}

/**
 * Run tests and capture results
 */
function runTests(): TestResults {
  const execOptions: ExecSyncOptionsWithStringEncoding = {
    encoding: 'utf-8',
    cwd: process.cwd(),
    env: { ...process.env, CI: 'true' },
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
  };

  const startTime = Date.now();
  let success = false;
  let rawOutput = '';
  let errorOutput = '';

  try {
    rawOutput = execSync('npm test -- --json --outputFile=test-results.json 2>&1', execOptions);
    success = true;
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      const execError = error as Error & { stdout?: string; stderr?: string };
      rawOutput = execError.stdout || '';
      errorOutput = execError.stderr || '';
    }
    success = false;
  }

  const duration = Date.now() - startTime;

  // Try to read Jest JSON output
  try {
    const resultsPath = path.join(process.cwd(), 'test-results.json');
    if (fs.existsSync(resultsPath)) {
      const jestResults = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
      return {
        success: jestResults.success ?? success,
        numTotalTests: jestResults.numTotalTests ?? 0,
        numPassedTests: jestResults.numPassedTests ?? 0,
        numFailedTests: jestResults.numFailedTests ?? 0,
        numPendingTests: jestResults.numPendingTests ?? 0,
        duration,
        testSuites: {
          total: jestResults.numTotalTestSuites ?? 0,
          passed: jestResults.numPassedTestSuites ?? 0,
          failed: jestResults.numFailedTestSuites ?? 0,
        },
        rawOutput,
        errorOutput,
      };
    }
  } catch {
    // Fall through to default parsing
  }

  // Fallback: parse output for test counts
  const passMatch = rawOutput.match(/(\d+) passed/);
  const failMatch = rawOutput.match(/(\d+) failed/);
  const totalMatch = rawOutput.match(/Tests:\s+.*?(\d+) total/);

  return {
    success,
    numTotalTests: totalMatch ? parseInt(totalMatch[1], 10) : 0,
    numPassedTests: passMatch ? parseInt(passMatch[1], 10) : 0,
    numFailedTests: failMatch ? parseInt(failMatch[1], 10) : 0,
    numPendingTests: 0,
    duration,
    testSuites: {
      total: 0,
      passed: 0,
      failed: 0,
    },
    rawOutput,
    errorOutput,
  };
}

/**
 * Determine action based on test results and scope
 */
function determineAction(
  results: TestResults,
  scope: Scope
): ActionType {
  if (!results.success && scope !== 'prod') {
    // Tests failed, but not in prod scope - can retry
    return 'rerun_pipeline';
  }

  // Tests passed or we're in prod (should verify regardless)
  return 'verify_pipeline';
}

/**
 * Build evidence from test results
 */
function buildEvidence(results: TestResults): Evidence[] {
  const ctx = getGitHubContext();
  const evidence: Evidence[] = [];

  evidence.push({
    type: 'git_context',
    source: 'github_context',
    summary: `Run ${ctx.runNumber} on ${ctx.ref}, SHA: ${ctx.sha.substring(0, 8)}`,
    data: {
      sha: ctx.sha,
      ref: ctx.ref,
      runId: ctx.runId,
      runNumber: ctx.runNumber,
    },
  });

  evidence.push({
    type: 'test_output',
    source: 'npm_test',
    summary: `${results.numPassedTests}/${results.numTotalTests} tests passed in ${results.duration}ms`,
    data: {
      success: results.success,
      total: results.numTotalTests,
      passed: results.numPassedTests,
      failed: results.numFailedTests,
      pending: results.numPendingTests,
      duration: results.duration,
      testSuites: results.testSuites,
    },
  });

  if (!results.success && results.errorOutput) {
    evidence.push({
      type: 'test_output',
      source: 'test_errors',
      summary: `Test failures detected: ${results.numFailedTests} failed tests`,
      data: {
        errorSnippet: results.errorOutput.substring(0, 1000),
      },
    });
  }

  return evidence;
}

/**
 * Main agent execution
 */
async function runCICDAgent(): Promise<AgentIntent> {
  const ctx = getGitHubContext();

  return withAgentSpan('cicd-agent', 'analyze', ctx, async (span) => {
    logAgentActivity('cicd-agent', 'Starting CI/CD analysis');

    // Determine scope
    const scope = determineScope();
    span.setAttribute('pipeline.scope', scope);

    // Run tests
    logAgentActivity('cicd-agent', 'Running tests...');
    span.addEvent('tests_started');
    
    const testResults = runTests();
    
    span.addEvent('tests_completed', {
      success: testResults.success,
      total: testResults.numTotalTests,
      passed: testResults.numPassedTests,
      failed: testResults.numFailedTests,
    });

    logAgentActivity('cicd-agent', 'Tests completed', {
      success: testResults.success,
      passed: testResults.numPassedTests,
      failed: testResults.numFailedTests,
    });

    // Determine action
    const action = determineAction(testResults, scope);
    span.setAction(action, scope);

    // Build intent
    const intent: AgentIntent = {
      agent: 'cicd-agent',
      action,
      target: 'pipeline',
      scope,
      timestamp: new Date().toISOString(),
      evidence: buildEvidence(testResults),
      metadata: {
        testSuccess: testResults.success,
        testsPassed: testResults.numPassedTests,
        testsFailed: testResults.numFailedTests,
        testsTotal: testResults.numTotalTests,
        duration: testResults.duration,
      },
    };

    logAgentActivity('cicd-agent', 'Analysis complete', {
      action: intent.action,
      scope: intent.scope,
      testSuccess: testResults.success,
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
  logAgentActivity('cicd-agent', `Intent written to ${outputPath}`);
}

// Main execution
async function main(): Promise<void> {
  initTelemetry();
  
  try {
    const intent = await runCICDAgent();
    writeIntent(intent);
    console.log('\n=== CI/CD Agent Intent ===');
    console.log(JSON.stringify(intent, null, 2));
  } catch (error) {
    console.error('CI/CD Agent failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);

export { runCICDAgent, runTests, determineScope };
