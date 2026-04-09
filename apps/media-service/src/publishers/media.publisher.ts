import { KAFKA_CLIENT } from '@libs/kafka';
import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import {
  lastValueFrom,
  timeout,
  retry,
  timer,
  catchError,
  throwError,
} from 'rxjs';

@Injectable()
export class MediaPublisher implements OnModuleInit {
  private readonly logger = new Logger(MediaPublisher.name);

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
              `Retry ${retryCount} for topic ${topic} in MediaPublisher due to error: ${error instanceof Error ? error.message : String(error)}`,
            );
            return timer(Math.pow(2, retryCount) * 1000);
          },
        }),

        catchError((err) => {
          this.logger.error(
            `Failed completely to send to ${topic} in MediaPublisher after ${MAX_RETRIES} attempts.`,
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
      return;
    } catch (error) {
      this.handleFallback(topic, payload, error);
    }
  }

  private handleFallback(topic: string, _payload: unknown, error: unknown) {
    this.logger.error(
      `Lost Kafka connection in MediaPublisher. Performing fallback for topic ${topic}`,
    );

    throw error;
  }
}
