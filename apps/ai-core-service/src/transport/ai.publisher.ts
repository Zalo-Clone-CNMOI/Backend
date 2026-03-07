import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import {
  lastValueFrom,
  timeout,
  retry,
  timer,
  catchError,
  throwError,
} from 'rxjs';

@Injectable()
export class AiPublisher implements OnModuleInit {
  private readonly logger = new Logger(AiPublisher.name);

  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka) {}

  async onModuleInit() {
    await this.kafka.connect();
  }

  async emit(topic: string, payload: unknown): Promise<void> {
    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 5000;

    try {
      const source$ = this.kafka.emit(topic, payload).pipe(
        timeout(TIMEOUT_MS),

        retry({
          count: MAX_RETRIES,
          delay: (error, retryCount) => {
            this.logger.warn(
              `Retry ${retryCount} for topic ${topic} due to: ${error instanceof Error ? error.message : String(error)}`,
            );
            return timer(Math.pow(2, retryCount) * 1000);
          },
        }),

        catchError((err) => {
          this.logger.error(
            `Failed to emit to ${topic} after ${MAX_RETRIES} retries`,
          );
          return throwError(
            () =>
              new Error(
                `Kafka Emit Failed: ${err instanceof Error ? err.message : String(err)}`,
              ),
          );
        }),
      );

      await lastValueFrom(source$);
    } catch (error) {
      this.logger.error(
        `AiPublisher fallback triggered for topic ${topic}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
