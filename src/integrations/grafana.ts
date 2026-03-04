import axios, { AxiosInstance } from 'axios';

export interface GrafanaAlert {
  id: number;
  dashboardId: number;
  panelId: number;
  name: string;
  state: 'ok' | 'paused' | 'alerting' | 'pending' | 'no_data';
  newStateDate: string;
  evalData?: {
    evalMatches?: Array<{
      metric: string;
      value: number;
    }>;
  };
}

export interface GrafanaHealthStatus {
  healthy: boolean;
  activeAlerts: GrafanaAlert[];
  dashboardStatus: DashboardStatus[];
}

export interface DashboardStatus {
  uid: string;
  title: string;
  panels: PanelStatus[];
}

export interface PanelStatus {
  id: number;
  title: string;
  alertState?: string;
  healthy: boolean;
}

export class GrafanaClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.GRAFANA_URL || 'http://localhost:3001';
    const apiKey = process.env.GRAFANA_API_KEY;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
  }

  /**
   * Get all active alerts from Grafana
   */
  async getActiveAlerts(): Promise<GrafanaAlert[]> {
    try {
      const response = await this.client.get<GrafanaAlert[]>('/api/alerts', {
        params: {
          state: 'alerting'
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching Grafana alerts:', error);
      return [];
    }
  }

  /**
   * Get alerts for a specific dashboard
   */
  async getDashboardAlerts(dashboardUid: string): Promise<GrafanaAlert[]> {
    try {
      // First get the dashboard to find its ID
      const dashboard = await this.getDashboard(dashboardUid);
      if (!dashboard) return [];

      const response = await this.client.get<GrafanaAlert[]>('/api/alerts', {
        params: {
          dashboardId: dashboard.id
        }
      });
      return response.data.filter(alert => alert.state === 'alerting');
    } catch (error) {
      console.error(`Error fetching alerts for dashboard ${dashboardUid}:`, error);
      return [];
    }
  }

  /**
   * Get dashboard by UID
   */
  async getDashboard(uid: string): Promise<{ id: number; uid: string; title: string; panels: Array<{ id: number; title: string; alert?: { state: string } }> } | null> {
    try {
      const response = await this.client.get(`/api/dashboards/uid/${uid}`);
      return response.data.dashboard;
    } catch (error) {
      console.error(`Error fetching dashboard ${uid}:`, error);
      return null;
    }
  }

  /**
   * Check overall system health based on Grafana alerts
   */
  async checkSystemHealth(): Promise<GrafanaHealthStatus> {
    const activeAlerts = await this.getActiveAlerts();
    const dashboardStatus: DashboardStatus[] = [];

    // Check key dashboards
    const keyDashboards = ['system-health', 'infrastructure', 'applications'];
    
    for (const dashboardUid of keyDashboards) {
      const dashboard = await this.getDashboard(dashboardUid);
      if (dashboard) {
        const panels: PanelStatus[] = dashboard.panels.map(panel => ({
          id: panel.id,
          title: panel.title,
          alertState: panel.alert?.state,
          healthy: !panel.alert || panel.alert.state === 'ok'
        }));

        dashboardStatus.push({
          uid: dashboard.uid,
          title: dashboard.title,
          panels
        });
      }
    }

    return {
      healthy: activeAlerts.length === 0,
      activeAlerts,
      dashboardStatus
    };
  }

  /**
   * Check if a specific service is healthy based on Grafana panels
   */
  async checkServiceHealth(serviceName: string): Promise<{
    healthy: boolean;
    alerts: GrafanaAlert[];
    metrics: { name: string; value: number; status: string }[];
  }> {
    try {
      // Search for dashboards related to this service
      const searchResponse = await this.client.get('/api/search', {
        params: {
          query: serviceName,
          type: 'dash-db'
        }
      });

      const alerts: GrafanaAlert[] = [];
      const metrics: { name: string; value: number; status: string }[] = [];

      for (const result of searchResponse.data) {
        const dashboardAlerts = await this.getDashboardAlerts(result.uid);
        alerts.push(...dashboardAlerts);
      }

      // Query specific metrics if available
      const metricsData = await this.queryMetrics(serviceName);
      metrics.push(...metricsData);

      return {
        healthy: alerts.length === 0,
        alerts,
        metrics
      };
    } catch (error) {
      console.error(`Error checking service health for ${serviceName}:`, error);
      return {
        healthy: true, // Assume healthy if we can't check
        alerts: [],
        metrics: []
      };
    }
  }

  /**
   * Query Prometheus/Grafana metrics for a service
   */
  async queryMetrics(serviceName: string): Promise<{ name: string; value: number; status: string }[]> {
    const metrics: { name: string; value: number; status: string }[] = [];

    try {
      // Query error rate
      const errorRateQuery = `sum(rate(http_requests_total{service="${serviceName}",status=~"5.."}[5m])) / sum(rate(http_requests_total{service="${serviceName}"}[5m])) * 100`;
      const errorRateResult = await this.queryPrometheus(errorRateQuery);
      
      if (errorRateResult !== null) {
        metrics.push({
          name: 'error_rate_percent',
          value: errorRateResult,
          status: errorRateResult > 5 ? 'critical' : errorRateResult > 1 ? 'warning' : 'ok'
        });
      }

      // Query latency p99
      const latencyQuery = `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service="${serviceName}"}[5m])) by (le))`;
      const latencyResult = await this.queryPrometheus(latencyQuery);
      
      if (latencyResult !== null) {
        metrics.push({
          name: 'latency_p99_seconds',
          value: latencyResult,
          status: latencyResult > 2 ? 'critical' : latencyResult > 0.5 ? 'warning' : 'ok'
        });
      }

      // Query availability
      const availQuery = `avg(up{service="${serviceName}"}) * 100`;
      const availResult = await this.queryPrometheus(availQuery);
      
      if (availResult !== null) {
        metrics.push({
          name: 'availability_percent',
          value: availResult,
          status: availResult < 95 ? 'critical' : availResult < 99 ? 'warning' : 'ok'
        });
      }

    } catch (error) {
      console.error(`Error querying metrics for ${serviceName}:`, error);
    }

    return metrics;
  }

  /**
   * Execute a Prometheus query via Grafana
   */
  private async queryPrometheus(query: string): Promise<number | null> {
    try {
      const response = await this.client.get('/api/datasources/proxy/1/api/v1/query', {
        params: { query }
      });

      if (response.data.status === 'success' && response.data.data.result.length > 0) {
        return parseFloat(response.data.data.result[0].value[1]);
      }
    } catch (error) {
      // Prometheus datasource might not be available
      console.debug('Prometheus query failed:', error);
    }
    return null;
  }

  /**
   * Check if there are any critical alerts that should block deployments
   */
  async shouldBlockDeployment(): Promise<{
    shouldBlock: boolean;
    reason: string;
    alerts: GrafanaAlert[];
  }> {
    const activeAlerts = await this.getActiveAlerts();
    
    // Filter for critical alerts (you can customize this logic)
    const criticalAlerts = activeAlerts.filter(alert => {
      // Consider alerts as critical if they contain certain keywords
      const criticalKeywords = ['critical', 'down', 'outage', 'error-rate', 'latency'];
      return criticalKeywords.some(keyword => 
        alert.name.toLowerCase().includes(keyword)
      );
    });

    if (criticalAlerts.length > 0) {
      return {
        shouldBlock: true,
        reason: `${criticalAlerts.length} critical alert(s) active: ${criticalAlerts.map(a => a.name).join(', ')}`,
        alerts: criticalAlerts
      };
    }

    // Also block if there are too many non-critical alerts
    if (activeAlerts.length > 5) {
      return {
        shouldBlock: true,
        reason: `Too many active alerts (${activeAlerts.length}). Resolve some before deploying.`,
        alerts: activeAlerts
      };
    }

    return {
      shouldBlock: false,
      reason: 'No blocking alerts detected',
      alerts: activeAlerts
    };
  }
}
