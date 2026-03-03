/**
 * OpenTelemetry instrumentation for agent observability
 * Provides tracing capabilities for all agents with console exporter by default
 */

import { trace, SpanStatusCode, Span, Tracer, SpanKind } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import type { AgentName, GitHubContext } from './types.js';

let sdk: NodeSDK | null = null;
let initialized = false;

/**
 * Initialize OpenTelemetry SDK with console exporter
 */
export function initTelemetry(serviceName = 'enterprise-cicd-agents'): void {
  if (initialized) return;

  sdk = new NodeSDK({
    serviceName,
    traceExporter: new ConsoleSpanExporter(),
  });

  sdk.start();
  initialized = true;

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk?.shutdown().catch(console.error);
  });
}

/**
 * Shutdown telemetry gracefully
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    initialized = false;
    sdk = null;
  }
}

/**
 * Get tracer for a specific agent
 */
export function getTracer(agentName: AgentName): Tracer {
  return trace.getTracer(`agent.${agentName}`, '1.0.0');
}

/**
 * Agent span attributes interface
 */
export interface AgentSpanAttributes {
  'agent.name': AgentName;
  'agent.action'?: string;
  'agent.scope'?: string;
  'github.run_id': string;
  'github.sha': string;
  'github.actor': string;
  'github.event_name': string;
  'github.repository': string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Create a span wrapper for agent execution
 */
export class AgentSpan {
  private span: Span;
  private startTime: number;

  constructor(
    agentName: AgentName,
    operationName: string,
    githubContext: GitHubContext
  ) {
    const tracer = getTracer(agentName);
    this.startTime = Date.now();
    
    this.span = tracer.startSpan(`${agentName}.${operationName}`, {
      kind: SpanKind.INTERNAL,
      attributes: this.buildAttributes(agentName, githubContext),
    });
  }

  private buildAttributes(
    agentName: AgentName,
    ctx: GitHubContext
  ): AgentSpanAttributes {
    return {
      'agent.name': agentName,
      'github.run_id': ctx.runId,
      'github.sha': ctx.sha,
      'github.actor': ctx.actor,
      'github.event_name': ctx.eventName,
      'github.repository': ctx.repository,
    };
  }

  /**
   * Set action-related attributes
   */
  setAction(action: string, scope: string): void {
    this.span.setAttribute('agent.action', action);
    this.span.setAttribute('agent.scope', scope);
  }

  /**
   * Add custom attribute
   */
  setAttribute(key: string, value: string | number | boolean): void {
    this.span.setAttribute(key, value);
  }

  /**
   * Add event to span
   */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    this.span.addEvent(name, attributes);
  }

  /**
   * Record an error
   */
  recordError(error: Error): void {
    this.span.recordException(error);
    this.span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  }

  /**
   * End span successfully
   */
  end(): void {
    const duration = Date.now() - this.startTime;
    this.span.setAttribute('duration_ms', duration);
    this.span.setStatus({ code: SpanStatusCode.OK });
    this.span.end();
  }

  /**
   * End span with error
   */
  endWithError(error: Error): void {
    this.recordError(error);
    this.span.end();
  }
}

/**
 * Decorator-like function to wrap agent execution with tracing
 */
export async function withAgentSpan<T>(
  agentName: AgentName,
  operationName: string,
  githubContext: GitHubContext,
  fn: (span: AgentSpan) => Promise<T>
): Promise<T> {
  const span = new AgentSpan(agentName, operationName, githubContext);
  
  try {
    const result = await fn(span);
    span.end();
    return result;
  } catch (error) {
    span.endWithError(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Log agent activity (always logs to console for visibility)
 */
export function logAgentActivity(
  agentName: AgentName,
  message: string,
  data?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    agent: agentName,
    message,
    ...data,
  };
  console.log(JSON.stringify(logEntry));
}
