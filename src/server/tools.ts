/**
 * Governance Tools for Copilot SDK
 * 
 * These tools enable the AI to execute specific governance actions
 * during PR analysis and deployment decisions.
 * 
 * Uses raw JSON schemas as per SDK alternative format.
 */

import { defineTool } from '@github/copilot-sdk';

/**
 * Policy compliance checker
 */
export const checkPolicyCompliance = defineTool('check_policy_compliance', {
  description: 'Check if a change complies with enterprise governance policies. Use this to validate infrastructure changes, security configurations, and deployment requests against policy rules.',
  parameters: {
    type: 'object',
    properties: {
      changeType: {
        type: 'string',
        enum: ['infrastructure', 'security', 'application', 'configuration'],
        description: 'Type of change being evaluated'
      },
      targetEnvironment: {
        type: 'string',
        enum: ['development', 'staging', 'production'],
        description: 'Target environment for the change'
      },
      riskLevel: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'Assessed risk level of the change'
      }
    },
    required: ['changeType', 'targetEnvironment']
  },
  handler: async (params: { changeType: string; targetEnvironment: string; riskLevel?: string }) => {
    // Policy rules encoded here - in production, this would query a policy engine
    const policies: Record<string, Record<string, { requiresApproval: boolean; minReviewers: number; requiresSecurityReview: boolean }>> = {
      infrastructure: {
        production: { requiresApproval: true, minReviewers: 2, requiresSecurityReview: true },
        staging: { requiresApproval: true, minReviewers: 1, requiresSecurityReview: false },
        development: { requiresApproval: false, minReviewers: 0, requiresSecurityReview: false }
      },
      security: {
        production: { requiresApproval: true, minReviewers: 2, requiresSecurityReview: true },
        staging: { requiresApproval: true, minReviewers: 2, requiresSecurityReview: true },
        development: { requiresApproval: true, minReviewers: 1, requiresSecurityReview: true }
      },
      application: {
        production: { requiresApproval: true, minReviewers: 1, requiresSecurityReview: false },
        staging: { requiresApproval: false, minReviewers: 0, requiresSecurityReview: false },
        development: { requiresApproval: false, minReviewers: 0, requiresSecurityReview: false }
      },
      configuration: {
        production: { requiresApproval: true, minReviewers: 2, requiresSecurityReview: true },
        staging: { requiresApproval: true, minReviewers: 1, requiresSecurityReview: false },
        development: { requiresApproval: false, minReviewers: 0, requiresSecurityReview: false }
      }
    };

    const policy = policies[params.changeType]?.[params.targetEnvironment];
    
    if (!policy) {
      return { compliant: false, reason: 'Unknown change type or environment' };
    }

    // High/critical risk always requires approval
    if (params.riskLevel === 'critical') {
      return {
        compliant: false,
        reason: 'Critical risk changes require executive approval',
        requirements: { ...policy, requiresExecutiveApproval: true }
      };
    }

    if (params.riskLevel === 'high' && params.targetEnvironment === 'production') {
      return {
        compliant: true,
        requirements: { ...policy, minReviewers: Math.max(policy.minReviewers, 2) },
        warnings: ['High risk production change - ensure thorough review']
      };
    }

    return {
      compliant: true,
      requirements: policy
    };
  }
});

/**
 * Security risk assessor
 */
export const assessSecurityRisk = defineTool('assess_security_risk', {
  description: 'Assess security risk of code changes based on file patterns and content analysis. Use this when reviewing PRs with security-sensitive changes.',
  parameters: {
    type: 'object',
    properties: {
      filesChanged: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of file paths that were changed'
      },
      hasSecrets: {
        type: 'boolean',
        description: 'Whether the changes appear to contain secrets or credentials'
      },
      hasNetworkChanges: {
        type: 'boolean',
        description: 'Whether the changes affect network configuration'
      },
      hasAuthChanges: {
        type: 'boolean',
        description: 'Whether the changes affect authentication/authorization'
      }
    },
    required: ['filesChanged']
  },
  handler: async (params: { filesChanged: string[]; hasSecrets?: boolean; hasNetworkChanges?: boolean; hasAuthChanges?: boolean }) => {
    let riskScore = 0;
    const risks: string[] = [];

    // Analyze file patterns
    const sensitivePatterns = [
      { pattern: /\.env/, risk: 30, message: 'Environment file changes detected' },
      { pattern: /secret|credential|password|token/i, risk: 40, message: 'Potential credential-related changes' },
      { pattern: /auth|login|session/i, risk: 25, message: 'Authentication-related changes' },
      { pattern: /infra\/prod|production/i, risk: 35, message: 'Production infrastructure changes' },
      { pattern: /security|firewall|network/i, risk: 30, message: 'Security configuration changes' },
      { pattern: /\.tf$|\.bicep$/i, risk: 20, message: 'Infrastructure as Code changes' }
    ];

    for (const file of params.filesChanged) {
      for (const { pattern, risk, message } of sensitivePatterns) {
        if (pattern.test(file)) {
          riskScore += risk;
          if (!risks.includes(message)) {
            risks.push(message);
          }
        }
      }
    }

    // Additional risk factors
    if (params.hasSecrets) {
      riskScore += 50;
      risks.push('CRITICAL: Potential secrets detected in changes');
    }
    if (params.hasNetworkChanges) {
      riskScore += 20;
      risks.push('Network configuration changes require security review');
    }
    if (params.hasAuthChanges) {
      riskScore += 25;
      risks.push('Authentication changes require security review');
    }

    // Determine risk level
    let riskLevel: string;
    if (riskScore >= 80) {
      riskLevel = 'critical';
    } else if (riskScore >= 50) {
      riskLevel = 'high';
    } else if (riskScore >= 25) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    return {
      riskLevel,
      riskScore,
      risks,
      recommendation: riskScore >= 50 ? 'Require security team review before merge' : 'Standard review process'
    };
  }
});

/**
 * Test coverage evaluator
 */
export const evaluateTestCoverage = defineTool('evaluate_test_coverage', {
  description: 'Evaluate test coverage and quality for the changes. Use this to determine if changes have adequate test coverage.',
  parameters: {
    type: 'object',
    properties: {
      testsPassed: { type: 'number', description: 'Number of tests that passed' },
      testsFailed: { type: 'number', description: 'Number of tests that failed' },
      coveragePercent: { type: 'number', description: 'Code coverage percentage' },
      newFilesCount: { type: 'number', description: 'Number of new files added' },
      newTestsCount: { type: 'number', description: 'Number of new test files added' }
    },
    required: ['testsPassed', 'testsFailed']
  },
  handler: async (params: { testsPassed: number; testsFailed: number; coveragePercent?: number; newFilesCount?: number; newTestsCount?: number }) => {
    const issues: string[] = [];
    let qualityScore = 100;

    // Silence unused variable warning
    void params.testsPassed;

    // Failed tests
    if (params.testsFailed > 0) {
      qualityScore -= 50;
      issues.push(`${params.testsFailed} test(s) failing - must fix before merge`);
    }

    // Coverage check
    if (params.coveragePercent !== undefined) {
      if (params.coveragePercent < 60) {
        qualityScore -= 30;
        issues.push(`Low test coverage (${params.coveragePercent}%) - recommend adding tests`);
      } else if (params.coveragePercent < 80) {
        qualityScore -= 10;
        issues.push(`Coverage could be improved (${params.coveragePercent}%)`);
      }
    }

    // New files without tests
    if (params.newFilesCount && params.newTestsCount !== undefined) {
      if (params.newFilesCount > 0 && params.newTestsCount === 0) {
        qualityScore -= 20;
        issues.push('New files added without corresponding tests');
      }
    }

    return {
      qualityScore,
      canMerge: params.testsFailed === 0 && qualityScore >= 50,
      issues,
      recommendation: params.testsFailed > 0 
        ? 'BLOCK: Fix failing tests before merge'
        : qualityScore < 50 
          ? 'REVIEW: Address quality concerns'
          : 'APPROVE: Tests pass with acceptable quality'
    };
  }
});

/**
 * Deployment checklist generator
 */
export const generateDeploymentChecklist = defineTool('generate_deployment_checklist', {
  description: 'Generate a deployment checklist based on the type of changes and target environment.',
  parameters: {
    type: 'object',
    properties: {
      environment: {
        type: 'string',
        enum: ['development', 'staging', 'production'],
        description: 'Target deployment environment'
      },
      hasInfraChanges: {
        type: 'boolean',
        description: 'Whether deployment includes infrastructure changes'
      },
      hasDatabaseChanges: {
        type: 'boolean',
        description: 'Whether deployment includes database migrations'
      },
      isHotfix: {
        type: 'boolean',
        description: 'Whether this is an emergency hotfix'
      }
    },
    required: ['environment']
  },
  handler: async (params: { environment: string; hasInfraChanges?: boolean; hasDatabaseChanges?: boolean; isHotfix?: boolean }) => {
    const checklist: Array<{ item: string; required: boolean; automated: boolean }> = [];

    // Base checklist
    checklist.push(
      { item: 'All tests passing', required: true, automated: true },
      { item: 'Code review approved', required: params.environment !== 'development', automated: false },
      { item: 'No security vulnerabilities', required: true, automated: true }
    );

    // Environment-specific
    if (params.environment === 'production') {
      checklist.push(
        { item: 'Staging deployment verified', required: true, automated: false },
        { item: 'Performance impact assessed', required: true, automated: false },
        { item: 'Rollback plan documented', required: true, automated: false },
        { item: 'On-call team notified', required: true, automated: false }
      );
    }

    if (params.environment === 'staging') {
      checklist.push(
        { item: 'Integration tests passed', required: true, automated: true },
        { item: 'Smoke tests planned', required: true, automated: false }
      );
    }

    // Change-specific
    if (params.hasInfraChanges) {
      checklist.push(
        { item: 'Infrastructure plan reviewed', required: true, automated: false },
        { item: 'Cost impact assessed', required: params.environment === 'production', automated: false },
        { item: 'Terraform/Bicep plan generated', required: true, automated: true }
      );
    }

    if (params.hasDatabaseChanges) {
      checklist.push(
        { item: 'Database backup taken', required: params.environment === 'production', automated: true },
        { item: 'Migration tested on staging', required: true, automated: false },
        { item: 'Rollback migration ready', required: true, automated: false }
      );
    }

    // Hotfix
    if (params.isHotfix) {
      checklist.push(
        { item: 'Incident documented', required: true, automated: false },
        { item: 'Post-mortem scheduled', required: true, automated: false }
      );
    }

    return {
      environment: params.environment,
      checklist,
      requiredItems: checklist.filter(c => c.required).length,
      automatedItems: checklist.filter(c => c.automated).length
    };
  }
});

// Export all tools as an array for use in createSession
export const governanceTools = [
  checkPolicyCompliance,
  assessSecurityRisk,
  evaluateTestCoverage,
  generateDeploymentChecklist
];
