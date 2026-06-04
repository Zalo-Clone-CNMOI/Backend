// Docker container name (cAdvisor `name` label) ↔ display service name
export const MONITORED_CONTAINERS: ReadonlyArray<{
  container: string;
  service: string;
}> = [
  { container: 'zalo_bff_service', service: 'bff-service' },
  { container: 'zalo_sso_service', service: 'sso-service' },
  { container: 'zalo_interaction_service', service: 'interaction-service' },
  { container: 'zalo_media_service', service: 'media-service' },
  { container: 'zalo_chat_service', service: 'chat-service' },
  { container: 'zalo_ws_gateway', service: 'ws-gateway' },
  { container: 'zalo_ai_core_service', service: 'ai-core-service' },
  { container: 'zalo_notification_service', service: 'notification-service' },
  { container: 'zalo_presence_service', service: 'presence-service' },
];

export const PROMQL = {
  up: '(time() - container_last_seen{name=~"zalo_.+"}) < 60',
  restarts24h: 'changes(container_start_time_seconds{name=~"zalo_.+"}[24h])',
  uptime: 'time() - container_start_time_seconds{name=~"zalo_.+"}',
  probeSuccess: 'probe_success{job="blackbox-health"}',
} as const;

export const HEALTH_QUERY_TIMEOUT_MS = 5_000;
