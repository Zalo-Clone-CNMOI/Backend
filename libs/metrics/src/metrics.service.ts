import { Injectable, Logger } from '@nestjs/common';
import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  public readonly register: Registry;
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  constructor() {
    this.register = new Registry();
    collectDefaultMetrics({ register: this.register });
    this.logger.log('Metrics service initialized with default metrics');
  }

  /**
   * Get or create a counter metric
   */
  getCounter(name: string, help: string, labelNames: string[] = []): Counter {
    const existing = this.counters.get(name);
    if (existing) return existing;

    const counter = new Counter({
      name,
      help,
      labelNames,
      registers: [this.register],
    });

    this.counters.set(name, counter);
    return counter;
  }

  /**
   * Get or create a gauge metric
   */
  getGauge(name: string, help: string, labelNames: string[] = []): Gauge {
    const existing = this.gauges.get(name);
    if (existing) return existing;

    const gauge = new Gauge({
      name,
      help,
      labelNames,
      registers: [this.register],
    });

    this.gauges.set(name, gauge);
    return gauge;
  }

  /**
   * Get or create a histogram metric
   */
  getHistogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets?: number[],
  ): Histogram {
    const existing = this.histograms.get(name);
    if (existing) return existing;

    const histogram = new Histogram({
      name,
      help,
      labelNames,
      buckets,
      registers: [this.register],
    });

    this.histograms.set(name, histogram);
    return histogram;
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  /**
   * Get metrics as JSON
   */
  async getMetricsJSON() {
    return this.register.getMetricsAsJSON();
  }
}
