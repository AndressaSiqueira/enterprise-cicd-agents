import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { Octokit } from '@octokit/rest';
import { AzureMonitorClient, HealthStatus, AlertInfo, MetricResult } from './azure-monitor.js';
import { GrafanaClient, GrafanaAlert } from './grafana.js';

export interface RepoConfig {
  description: string;
  dependencies: string[];
  critical: boolean;
}

export interface DependencyConfig {
  repositories: Record<string, RepoConfig>;
  rules: {
    check_dependency_prs: boolean;
    check_dependency_health: boolean;
    check_active_incidents: boolean;
    health_threshold: number;
  };
  azure_monitor: {
    resource_mapping: Record<string, string>;
    metrics: Array<{ name: string; threshold: number }>;
  };
  grafana: {
    dashboard_uid: string;
    alerts_panel: string;
    max_active_alerts: number;
  };
}

export interface MultiRepoCheckResult {
  repo: string;
  action: 'deploy' | 'merge' | 'release';
  decision: 'APPROVE' | 'BLOCK' | 'REVIEW';
  factors: Factor[];
  dependencyStatus: DependencyStatus[];
  systemHealth: SystemHealth;
  aiAnalysis: string;
  timestamp: string;
}

export interface Factor {
  type: 'success' | 'warning' | 'error';
  source: 'github' | 'azure-monitor' | 'grafana' | 'policy';
  message: string;
}

export interface DependencyStatus {
  repo: string;
  healthy: boolean;
  openPRs: number;
  breakingChanges: boolean;
  lastDeployStatus: string;
  healthMetrics?: HealthStatus;
}

export interface SystemHealth {
  azureMonitor: {
    healthy: boolean;
    activeIncidents: number;
    metrics: Array<{ name: string; status: string }>;
  };
  grafana: {
    healthy: boolean;
    activeAlerts: number;
    alerts: GrafanaAlert[];
  };
}

export class DependencyService {
  private config: DependencyConfig;
  private octokit: Octokit;
  private azureMonitor: AzureMonitorClient;
  private grafana: GrafanaClient;

  constructor(githubToken: string) {
    this.config = this.loadConfig();
    this.octokit = new Octokit({ auth: githubToken });
    this.azureMonitor = new AzureMonitorClient();
    this.grafana = new GrafanaClient();
  }

  private loadConfig(): DependencyConfig {
    const configPath = path.join(process.cwd(), 'config', 'dependencies.yaml');
    
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return yaml.parse(content) as DependencyConfig;
    }

    // Return default config if file doesn't exist
    return {
      repositories: {},
      rules: {
        check_dependency_prs: true,
        check_dependency_health: true,
        check_active_incidents: true,
        health_threshold: 95
      },
      azure_monitor: {
        resource_mapping: {},
        metrics: []
      },
      grafana: {
        dashboard_uid: 'system-health',
        alerts_panel: 'active-alerts',
        max_active_alerts: 0
      }
    };
  }

  /**
   * Get dependencies for a repository
   */
  getDependencies(repoName: string): string[] {
    return this.config.repositories[repoName]?.dependencies || [];
  }

  /**
   * Get all repos that depend on a given repo
   */
  getDependents(repoName: string): string[] {
    return Object.entries(this.config.repositories)
      .filter(([_, config]) => config.dependencies.includes(repoName))
      .map(([name, _]) => name);
  }

  /**
   * Check if a repo is critical
   */
  isCritical(repoName: string): boolean {
    return this.config.repositories[repoName]?.critical ?? false;
  }

  /**
   * Main method: Check if an action is allowed for a repo
   */
  async checkMultiRepo(
    owner: string,
    repo: string,
    action: 'deploy' | 'merge' | 'release'
  ): Promise<Omit<MultiRepoCheckResult, 'aiAnalysis'>> {
    const factors: Factor[] = [];
    const dependencyStatus: DependencyStatus[] = [];

    // 1. Check dependencies' status
    const dependencies = this.getDependencies(repo);
    
    for (const dep of dependencies) {
      const status = await this.checkDependencyStatus(owner, dep);
      dependencyStatus.push(status);

      if (!status.healthy) {
        factors.push({
          type: 'error',
          source: 'github',
          message: `Dependency ${dep} is unhealthy: ${status.lastDeployStatus}`
        });
      }

      if (status.breakingChanges) {
        factors.push({
          type: 'error',
          source: 'github',
          message: `Dependency ${dep} has pending breaking changes (${status.openPRs} open PRs)`
        });
      }
    }

    // 2. Check Azure Monitor
    const azureHealth = await this.checkAzureMonitorHealth(repo);
    if (!azureHealth.healthy) {
      factors.push({
        type: 'error',
        source: 'azure-monitor',
        message: `Azure Monitor shows ${azureHealth.activeIncidents} active incidents`
      });
    }

    // 3. Check Grafana
    const grafanaHealth = await this.checkGrafanaHealth();
    if (!grafanaHealth.healthy) {
      factors.push({
        type: 'error',
        source: 'grafana',
        message: `Grafana shows ${grafanaHealth.activeAlerts} active alerts`
      });
    }

    // 4. Check policy rules
    if (this.config.rules.check_active_incidents) {
      const incidents = await this.azureMonitor.hasActiveIncidents();
      if (incidents.hasIncidents) {
        factors.push({
          type: 'error',
          source: 'policy',
          message: `Active P0/P1 incidents detected: ${incidents.incidents.map((i: AlertInfo) => i.name).join(', ')}`
        });
      }
    }

    // 5. For critical repos, add extra scrutiny
    if (this.isCritical(repo) && action === 'deploy') {
      factors.push({
        type: 'warning',
        source: 'policy',
        message: `${repo} is marked as CRITICAL - requires extra approval for ${action}`
      });
    }

    // Determine decision
    const errors = factors.filter(f => f.type === 'error').length;
    const warnings = factors.filter(f => f.type === 'warning').length;

    let decision: 'APPROVE' | 'BLOCK' | 'REVIEW';
    if (errors > 0) {
      decision = 'BLOCK';
    } else if (warnings > 0) {
      decision = 'REVIEW';
    } else {
      decision = 'APPROVE';
      factors.push({
        type: 'success',
        source: 'policy',
        message: 'All dependency and health checks passed'
      });
    }

    return {
      repo,
      action,
      decision,
      factors,
      dependencyStatus,
      systemHealth: {
        azureMonitor: azureHealth,
        grafana: grafanaHealth
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check status of a dependency repo
   */
  private async checkDependencyStatus(owner: string, repo: string): Promise<DependencyStatus> {
    let openPRs = 0;
    let breakingChanges = false;
    let lastDeployStatus = 'unknown';
    let healthy = true;
    let healthMetrics: HealthStatus | undefined;

    try {
      // Check open PRs
      const { data: prs } = await this.octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        per_page: 100
      });
      openPRs = prs.length;

      // Check for breaking changes in PR titles/labels
      breakingChanges = prs.some(pr => 
        pr.title.toLowerCase().includes('breaking') ||
        pr.labels.some(l => l.name.toLowerCase().includes('breaking'))
      );

      // Check last deployment status
      const { data: deployments } = await this.octokit.repos.listDeployments({
        owner,
        repo,
        per_page: 1
      });

      if (deployments.length > 0) {
        const { data: statuses } = await this.octokit.repos.listDeploymentStatuses({
          owner,
          repo,
          deployment_id: deployments[0].id,
          per_page: 1
        });
        lastDeployStatus = statuses[0]?.state || 'unknown';
        healthy = lastDeployStatus === 'success';
      }

      // Check Azure Monitor metrics if configured
      const resourceId = this.config.azure_monitor.resource_mapping[repo];
      if (resourceId) {
        healthMetrics = await this.azureMonitor.checkResourceHealth(resourceId);
        healthy = healthy && healthMetrics.healthy;
      }

    } catch (error) {
      console.error(`Error checking dependency ${repo}:`, error);
      healthy = false;
      lastDeployStatus = 'error';
    }

    return {
      repo,
      healthy,
      openPRs,
      breakingChanges,
      lastDeployStatus,
      healthMetrics
    };
  }

  /**
   * Check Azure Monitor health for a repo
   */
  private async checkAzureMonitorHealth(repo: string): Promise<{
    healthy: boolean;
    activeIncidents: number;
    metrics: Array<{ name: string; status: string }>;
  }> {
    try {
      const incidents = await this.azureMonitor.hasActiveIncidents();
      
      // Check specific resource if mapped
      const resourceId = this.config.azure_monitor.resource_mapping[repo];
      let metrics: Array<{ name: string; status: string }> = [];
      
      if (resourceId) {
        const health = await this.azureMonitor.checkResourceHealth(resourceId);
        metrics = health.metrics.map((m: MetricResult) => ({ name: m.name, status: m.status }));
      }

      return {
        healthy: !incidents.hasIncidents,
        activeIncidents: incidents.incidents.length,
        metrics
      };
    } catch (error) {
      console.error('Error checking Azure Monitor:', error);
      return { healthy: true, activeIncidents: 0, metrics: [] };
    }
  }

  /**
   * Check Grafana health
   */
  private async checkGrafanaHealth(): Promise<{
    healthy: boolean;
    activeAlerts: number;
    alerts: GrafanaAlert[];
  }> {
    try {
      const blockCheck = await this.grafana.shouldBlockDeployment();
      const activeAlerts = await this.grafana.getActiveAlerts();

      return {
        healthy: !blockCheck.shouldBlock,
        activeAlerts: activeAlerts.length,
        alerts: activeAlerts
      };
    } catch (error) {
      console.error('Error checking Grafana:', error);
      return { healthy: true, activeAlerts: 0, alerts: [] };
    }
  }

  /**
   * Generate a summary for AI analysis
   */
  generateSummaryForAI(result: Omit<MultiRepoCheckResult, 'aiAnalysis'>): string {
    const lines: string[] = [
      `## Multi-Repo Governance Check`,
      `Repository: ${result.repo}`,
      `Action: ${result.action}`,
      `Current Decision: ${result.decision}`,
      '',
      '### Factors:',
      ...result.factors.map(f => `- [${f.type.toUpperCase()}] (${f.source}) ${f.message}`),
      '',
      '### Dependency Status:',
      ...result.dependencyStatus.map(d => 
        `- ${d.repo}: ${d.healthy ? '✅ Healthy' : '❌ Unhealthy'} (PRs: ${d.openPRs}, Breaking: ${d.breakingChanges}, Last Deploy: ${d.lastDeployStatus})`
      ),
      '',
      '### System Health:',
      `- Azure Monitor: ${result.systemHealth.azureMonitor.healthy ? '✅' : '❌'} (${result.systemHealth.azureMonitor.activeIncidents} incidents)`,
      `- Grafana: ${result.systemHealth.grafana.healthy ? '✅' : '❌'} (${result.systemHealth.grafana.activeAlerts} alerts)`,
      '',
      'Based on this data, provide:',
      '1. Should the action proceed? (APPROVE/BLOCK/REVIEW)',
      '2. Risk assessment',
      '3. Specific recommendations',
      '4. If BLOCK, what needs to be resolved first?'
    ];

    return lines.join('\n');
  }
}
