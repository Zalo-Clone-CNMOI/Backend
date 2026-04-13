export const KafkaReliabilityDefaults = {
  maxRetries: 3,
  timeoutMs: 5000,
  backoffBaseMs: 1000,
  backoffCapMs: 30000,
  dlqSuffix: 'dlq',
} as const;

export interface KafkaRetryPolicy {
  maxRetries: number;
  timeoutMs: number;
  backoffBaseMs: number;
  backoffCapMs: number;
}

export interface KafkaDlqEvent {
  original_topic: string;
  payload: unknown;
  error_message: string;
  retry_attempts: number;
  failed_at: number;
  producer: string;
  trace_id?: string;
}

export function toKafkaDlqTopic(topic: string): string {
  return `${topic}.${KafkaReliabilityDefaults.dlqSuffix}`;
}
