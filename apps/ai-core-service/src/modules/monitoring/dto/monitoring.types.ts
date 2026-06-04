export interface ContainerStatus {
  service: string;
  container: string;
  up: boolean;
  restarts24h: number;
  uptimeSeconds: number;
  healthProbe: 'up' | 'down' | 'unknown';
}

export interface LogLine {
  timestamp: string; // ISO
  line: string;
}

export interface StackHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: Record<'prometheus' | 'loki' | 'grafana', 'ok' | 'down'>;
  timestamp: string;
}

export interface AiAnalyzeResult {
  answer: string;
  model: string;
  provider: string;
}
