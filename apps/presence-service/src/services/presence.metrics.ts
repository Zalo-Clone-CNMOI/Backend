import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MetricsService } from '@libs/metrics';
import type { Counter, Gauge } from 'prom-client';

/**
 * Presence-specific metrics for monitoring
 */
@Injectable()
export class PresenceMetrics implements OnModuleInit {
  private readonly logger = new Logger(PresenceMetrics.name);

  // Counters
  private connectCounter!: Counter;
  private disconnectCounter!: Counter;
  private heartbeatCounter!: Counter;
  private cleanupCounter!: Counter;
  private degradedModeCounter!: Counter;
  private eventDuplicateCounter!: Counter;
  private eventOutOfOrderCounter!: Counter;

  // Gauges
  private activeUsersGauge!: Gauge;
  private activeSocketsGauge!: Gauge;
  private isDegradedGauge!: Gauge;

  constructor(private readonly metricsService: MetricsService) {}

  onModuleInit() {
    this.initializeMetrics();
    this.logger.log('Presence metrics initialized');
  }

  private initializeMetrics() {
    // Counters
    this.connectCounter = this.metricsService.getCounter(
      'presence_connect_total',
      'Total number of connection events processed',
      ['status', 'source'],
    );

    this.disconnectCounter = this.metricsService.getCounter(
      'presence_disconnect_total',
      'Total number of disconnection events processed',
      ['status', 'reason', 'source'],
    );

    this.heartbeatCounter = this.metricsService.getCounter(
      'presence_heartbeat_total',
      'Total number of heartbeat events processed',
      ['status'],
    );

    this.cleanupCounter = this.metricsService.getCounter(
      'presence_cleanup_total',
      'Total number of expired sockets cleaned up',
    );

    this.degradedModeCounter = this.metricsService.getCounter(
      'presence_degraded_mode_total',
      'Total number of times degraded mode was activated',
      ['operation'],
    );

    this.eventDuplicateCounter = this.metricsService.getCounter(
      'presence_event_duplicate_total',
      'Total number of duplicate events detected',
      ['event_type'],
    );

    this.eventOutOfOrderCounter = this.metricsService.getCounter(
      'presence_event_out_of_order_total',
      'Total number of out-of-order events detected',
      ['event_type'],
    );

    // Gauges
    this.activeUsersGauge = this.metricsService.getGauge(
      'presence_active_users',
      'Current number of online users',
    );

    this.activeSocketsGauge = this.metricsService.getGauge(
      'presence_active_sockets',
      'Current number of active socket connections',
    );

    this.isDegradedGauge = this.metricsService.getGauge(
      'presence_is_degraded',
      'Whether presence service is in degraded mode (1=degraded, 0=normal)',
    );

    // Initialize degraded mode gauge to 0
    this.isDegradedGauge.set(0);
  }

  // Connect metrics
  recordConnect(status: 'success' | 'failure', source: string = 'kafka') {
    this.connectCounter.inc({ status, source });
  }

  // Disconnect metrics
  recordDisconnect(
    status: 'success' | 'failure',
    reason: string = 'logical_disconnect',
    source: string = 'kafka',
  ) {
    this.disconnectCounter.inc({ status, reason, source });
  }

  // Heartbeat metrics
  recordHeartbeat(status: 'success' | 'failure') {
    this.heartbeatCounter.inc({ status });
  }

  // Cleanup metrics
  recordCleanup(count: number) {
    this.cleanupCounter.inc(count);
  }

  // Degraded mode metrics
  recordDegradedMode(operation: string) {
    this.degradedModeCounter.inc({ operation });
    this.isDegradedGauge.set(1);
  }

  clearDegradedMode() {
    this.isDegradedGauge.set(0);
  }

  // Event ordering metrics
  recordDuplicateEvent(eventType: string) {
    this.eventDuplicateCounter.inc({ event_type: eventType });
  }

  recordOutOfOrderEvent(eventType: string) {
    this.eventOutOfOrderCounter.inc({ event_type: eventType });
  }

  // Active user/socket tracking
  updateActiveUsers(count: number) {
    this.activeUsersGauge.set(count);
  }

  updateActiveSockets(count: number) {
    this.activeSocketsGauge.set(count);
  }
}
