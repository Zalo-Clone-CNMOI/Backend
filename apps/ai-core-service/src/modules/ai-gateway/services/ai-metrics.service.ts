import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '@libs/metrics';
import { Counter, Histogram, Gauge } from 'prom-client';

/**
 * AiMetricsService — 6 Prometheus metrics for AI Core Service.
 */
@Injectable()
export class AiMetricsService {
  private readonly logger = new Logger(AiMetricsService.name);

  private readonly tokensInCounter: Counter;
  private readonly tokensOutCounter: Counter;
  private readonly requestCounter: Counter;
  private readonly costCounter: Counter;
  private readonly latencyHistogram: Histogram;
  private readonly circuitStateGauge: Gauge;

  constructor(private readonly metrics: MetricsService) {
    this.tokensInCounter = this.metrics.getCounter(
      'ai_tokens_in_total',
      'Total input tokens sent to LLM providers',
      ['provider', 'feature', 'model'],
    );

    this.tokensOutCounter = this.metrics.getCounter(
      'ai_tokens_out_total',
      'Total output tokens received from LLM providers',
      ['provider', 'feature', 'model'],
    );

    this.requestCounter = this.metrics.getCounter(
      'ai_requests_total',
      'Total AI requests by feature and status',
      ['feature', 'provider', 'status'],
    );

    this.costCounter = this.metrics.getCounter(
      'ai_estimated_cost_usd_total',
      'Estimated cost in USD',
      ['provider', 'model'],
    );

    this.latencyHistogram = this.metrics.getHistogram(
      'ai_request_duration_seconds',
      'AI request duration in seconds',
      ['feature', 'provider'],
      [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    );

    this.circuitStateGauge = this.metrics.getGauge(
      'ai_circuit_breaker_state',
      'Circuit breaker state (0=closed, 1=half-open, 2=open)',
      ['provider'],
    );

    this.logger.log('AI metrics initialized');
  }

  recordRequest(
    feature: string,
    provider: string,
    model: string,
    tokensIn: number,
    tokensOut: number,
    latencyMs: number,
    success: boolean,
  ) {
    this.tokensInCounter.labels(provider, feature, model).inc(tokensIn);
    this.tokensOutCounter.labels(provider, feature, model).inc(tokensOut);
    this.requestCounter
      .labels(feature, provider, success ? 'success' : 'error')
      .inc();
    this.latencyHistogram.labels(feature, provider).observe(latencyMs / 1000);
  }

  recordCost(provider: string, model: string, costUsd: number) {
    this.costCounter.labels(provider, model).inc(costUsd);
  }

  setCircuitState(provider: string, state: 'closed' | 'half-open' | 'open') {
    const value = state === 'closed' ? 0 : state === 'half-open' ? 1 : 2;
    this.circuitStateGauge.labels(provider).set(value);
  }
}
