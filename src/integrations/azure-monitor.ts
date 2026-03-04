import { DefaultAzureCredential } from '@azure/identity';
import { MetricsQueryClient, LogsQueryClient } from '@azure/monitor-query';

export interface HealthStatus {
  resourceId: string;
  healthy: boolean;
  metrics: MetricResult[];
  alerts: AlertInfo[];
}

export interface MetricResult {
  name: string;
  value: number;
  threshold: number;
  status: 'ok' | 'warning' | 'critical';
}

export interface AlertInfo {
  name: string;
  severity: string;
  status: 'firing' | 'resolved';
  description: string;
}

export class AzureMonitorClient {
  private metricsClient: MetricsQueryClient;
  private logsClient: LogsQueryClient;
  private credential: DefaultAzureCredential;

  constructor() {
    this.credential = new DefaultAzureCredential();
    this.metricsClient = new MetricsQueryClient(this.credential);
    this.logsClient = new LogsQueryClient(this.credential);
  }

  /**
   * Check health metrics for a specific Azure resource
   */
  async checkResourceHealth(resourceId: string): Promise<HealthStatus> {
    const metrics: MetricResult[] = [];
    const alerts: AlertInfo[] = [];
    let healthy = true;

    try {
      // Query availability and performance metrics
      const metricsResponse = await this.metricsClient.queryResource(
        resourceId,
        ['requests/failed', 'requests/duration', 'availabilityResults/availabilityPercentage'],
        {
          timespan: { duration: 'PT1H' }, // Last hour
          granularity: 'PT5M',
          aggregations: ['Average', 'Count']
        }
      );

      for (const metric of metricsResponse.metrics) {
        const latestValue = this.getLatestMetricValue(metric);
        const threshold = this.getThreshold(metric.name);
        const status = this.evaluateMetric(metric.name, latestValue, threshold);

        metrics.push({
          name: metric.name,
          value: latestValue,
          threshold,
          status
        });

        if (status === 'critical') {
          healthy = false;
        }
      }

      // Query active alerts
      const alertsData = await this.queryActiveAlerts(resourceId);
      alerts.push(...alertsData);

      if (alerts.some(a => a.status === 'firing' && a.severity === 'Sev0')) {
        healthy = false;
      }

    } catch (error) {
      console.error(`Error checking health for ${resourceId}:`, error);
      healthy = false;
      metrics.push({
        name: 'health_check',
        value: 0,
        threshold: 1,
        status: 'critical'
      });
    }

    return { resourceId, healthy, metrics, alerts };
  }

  /**
   * Query active alerts for a resource using Log Analytics
   */
  async queryActiveAlerts(resourceId: string): Promise<AlertInfo[]> {
    const workspaceId = process.env.LOG_ANALYTICS_WORKSPACE_ID;
    
    if (!workspaceId) {
      console.warn('LOG_ANALYTICS_WORKSPACE_ID not set, skipping alerts query');
      return [];
    }

    try {
      const query = `
        AlertsManagementResources
        | where type == "microsoft.alertsmanagement/alerts"
        | where properties.essentials.targetResource contains "${resourceId}"
        | where properties.essentials.alertState == "New" or properties.essentials.alertState == "Acknowledged"
        | project 
            name = properties.essentials.alertRule,
            severity = properties.essentials.severity,
            status = "firing",
            description = properties.essentials.description
      `;

      const result = await this.logsClient.queryWorkspace(workspaceId, query, {
        duration: 'PT24H'
      });

      if (result.status === 'Success' && result.tables.length > 0) {
        return result.tables[0].rows.map(row => ({
          name: row[0] as string,
          severity: row[1] as string,
          status: 'firing' as const,
          description: row[3] as string || ''
        }));
      }
    } catch (error) {
      console.error('Error querying alerts:', error);
    }

    return [];
  }

  /**
   * Check if there are any active incidents (P0/P1 alerts)
   */
  async hasActiveIncidents(): Promise<{ hasIncidents: boolean; incidents: AlertInfo[] }> {
    const workspaceId = process.env.LOG_ANALYTICS_WORKSPACE_ID;
    
    if (!workspaceId) {
      return { hasIncidents: false, incidents: [] };
    }

    try {
      const query = `
        AlertsManagementResources
        | where type == "microsoft.alertsmanagement/alerts"
        | where properties.essentials.severity in ("Sev0", "Sev1")
        | where properties.essentials.alertState == "New" or properties.essentials.alertState == "Acknowledged"
        | project 
            name = properties.essentials.alertRule,
            severity = properties.essentials.severity,
            status = "firing",
            description = properties.essentials.description
      `;

      const result = await this.logsClient.queryWorkspace(workspaceId, query, {
        duration: 'PT24H'
      });

      if (result.status === 'Success' && result.tables.length > 0) {
        const incidents = result.tables[0].rows.map(row => ({
          name: row[0] as string,
          severity: row[1] as string,
          status: 'firing' as const,
          description: row[3] as string || ''
        }));

        return {
          hasIncidents: incidents.length > 0,
          incidents
        };
      }
    } catch (error) {
      console.error('Error checking incidents:', error);
    }

    return { hasIncidents: false, incidents: [] };
  }

  /**
   * Query Application Insights for dependency health
   */
  async checkDependencyHealth(_appInsightsResourceId: string, dependencyName: string): Promise<{
    healthy: boolean;
    successRate: number;
    avgDuration: number;
  }> {
    try {
      const query = `
        dependencies
        | where timestamp > ago(1h)
        | where name contains "${dependencyName}"
        | summarize 
            totalCalls = count(),
            failedCalls = countif(success == false),
            avgDuration = avg(duration)
        | extend successRate = (totalCalls - failedCalls) * 100.0 / totalCalls
      `;

      const workspaceId = process.env.LOG_ANALYTICS_WORKSPACE_ID;
      if (!workspaceId) {
        return { healthy: true, successRate: 100, avgDuration: 0 };
      }

      const result = await this.logsClient.queryWorkspace(workspaceId, query, {
        duration: 'PT1H'
      });

      if (result.status === 'Success' && result.tables.length > 0 && result.tables[0].rows.length > 0) {
        const row = result.tables[0].rows[0];
        const successRate = row[3] as number;
        const avgDuration = row[2] as number;

        return {
          healthy: successRate >= 95,
          successRate,
          avgDuration
        };
      }
    } catch (error) {
      console.error(`Error checking dependency ${dependencyName}:`, error);
    }

    return { healthy: true, successRate: 100, avgDuration: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getLatestMetricValue(metric: any): number {
    const timeseries = metric.timeseries?.[0];
    if (!timeseries || !timeseries.data?.length) return 0;
    
    const latest = timeseries.data[timeseries.data.length - 1];
    return latest?.average ?? latest?.count ?? 0;
  }

  private getThreshold(metricName: string): number {
    const thresholds: Record<string, number> = {
      'requests/failed': 10,
      'requests/duration': 5000, // 5 seconds
      'availabilityResults/availabilityPercentage': 95,
      'dependencies/failed': 5
    };
    return thresholds[metricName] ?? 100;
  }

  private evaluateMetric(name: string, value: number, threshold: number): 'ok' | 'warning' | 'critical' {
    // For availability, higher is better
    if (name.includes('availability') || name.includes('success')) {
      if (value >= threshold) return 'ok';
      if (value >= threshold - 5) return 'warning';
      return 'critical';
    }
    
    // For failures/duration, lower is better
    if (value <= threshold) return 'ok';
    if (value <= threshold * 1.5) return 'warning';
    return 'critical';
  }
}
