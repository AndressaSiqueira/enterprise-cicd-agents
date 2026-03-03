/**
 * Enterprise API Service
 * A minimal production-ish Node.js/TypeScript application
 */

export interface ServiceConfig {
  name: string;
  version: string;
  environment: 'development' | 'staging' | 'production';
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: Record<string, boolean>;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  requestId: string;
}

export class EnterpriseService {
  private readonly config: ServiceConfig;
  private startTime: Date;

  constructor(config: ServiceConfig) {
    this.config = config;
    this.startTime = new Date();
  }

  /**
   * Get service configuration
   */
  getConfig(): ServiceConfig {
    return { ...this.config };
  }

  /**
   * Perform health check
   */
  healthCheck(): HealthCheckResult {
    const checks: Record<string, boolean> = {
      memory: this.checkMemory(),
      uptime: this.checkUptime(),
    };

    const allHealthy = Object.values(checks).every(Boolean);

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: this.config.version,
      checks,
    };
  }

  /**
   * Get service uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Process a sample request
   */
  processRequest<T>(data: T): ApiResponse<T> {
    const requestId = this.generateRequestId();

    try {
      // Simulate processing
      return {
        success: true,
        data,
        requestId,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        requestId,
      };
    }
  }

  /**
   * Validate environment for deployment
   */
  validateEnvironment(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (this.config.environment === 'production') {
      // Production-specific checks
      if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
        issues.push('NODE_ENV should be set to production');
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  private checkMemory(): boolean {
    const used = process.memoryUsage();
    const heapUsedMB = used.heapUsed / 1024 / 1024;
    // Consider healthy if heap is under 512MB
    return heapUsedMB < 512;
  }

  private checkUptime(): boolean {
    // Consider healthy if uptime is non-negative (service is running)
    return this.getUptime() >= 0;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Factory function
export function createService(
  name = 'enterprise-api',
  version = '1.0.0',
  environment: ServiceConfig['environment'] = 'development'
): EnterpriseService {
  return new EnterpriseService({ name, version, environment });
}

// Entry point for direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const service = createService('enterprise-api', '1.0.0', 'development');
  console.log('Service started:', service.getConfig());
  console.log('Health check:', service.healthCheck());
}
