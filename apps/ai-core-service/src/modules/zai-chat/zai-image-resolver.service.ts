import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { S3Service } from '@libs/s3';
import type { AiZaiImageRef } from '@libs/contracts';
import type { LlmContentPart } from '../ai-gateway/interfaces';

const DEFAULT_MAX_IMAGES = 4;
/**
 * TTL for presigned image URLs. Longer than the usual 60s because the URL is
 * never exposed to users — only to the LLM router, which may queue/retry the
 * fetch. 5 minutes comfortably covers provider latency.
 */
const PRESIGN_TTL_SECONDS = 300;
/** Per-image byte cap for the base64-inline path (avoids huge payloads). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Resolves Zai image attachments (S3 keys) into LLM image content parts so a
 * vision-capable model can "see" them. Images-only — non-image MIME types are
 * dropped.
 *
 * Resolution mode mirrors how the LocDo router handles images:
 *  - presigned S3 URL (default) — the router fetches it directly; cheap, no
 *    base64 inflation;
 *  - base64 data URL — when the object store is not reachable by the router
 *    (e.g. LocalStack in dev), gated by `zaiVisionInlineBase64`.
 */
@Injectable()
export class ZaiImageResolverService {
  private readonly logger = new Logger(ZaiImageResolverService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly s3: S3Service,
  ) {}

  /**
   * Resolve image refs into `image_url` content parts. Honours the vision cap,
   * filters non-image MIME types, and skips any single image that fails to
   * resolve (best-effort — one bad image must not kill the whole reply).
   * Returns an empty array when there is nothing to attach.
   */
  async resolve(
    images: AiZaiImageRef[] | undefined,
    traceId?: string,
  ): Promise<LlmContentPart[]> {
    if (!images?.length) return [];

    const max = this.config.zaiVisionMaxImages ?? DEFAULT_MAX_IMAGES;
    const candidates = images
      .filter((img) => img.content_type?.startsWith('image/'))
      .slice(0, max);

    // Resolve in parallel — independent S3 calls; one failure skips just that image.
    const settled = await Promise.allSettled(
      candidates.map((img) => this.resolveOne(img)),
    );

    const parts: LlmContentPart[] = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        parts.push(result.value);
      } else {
        const reason: unknown = result.reason;
        this.logger.warn(
          `[${traceId ?? 'none'}] Failed to resolve Zai image ${candidates[i].key}: ${reason instanceof Error ? reason.message : String(reason)}`,
        );
      }
    });
    return parts;
  }

  private async resolveOne(img: AiZaiImageRef): Promise<LlmContentPart> {
    const url = this.config.zaiVisionInlineBase64
      ? await this.toBase64DataUrl(img)
      : (
          await this.s3.presignDownload(img.key, {
            expiresSeconds: PRESIGN_TTL_SECONDS,
          })
        ).downloadUrl;
    return { type: 'image_url', url, mime_type: img.content_type };
  }

  private async toBase64DataUrl(img: AiZaiImageRef): Promise<string> {
    const buf = await this.s3.download(img.key);
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `image ${img.key} is ${buf.length} bytes, exceeds inline cap ${MAX_IMAGE_BYTES}`,
      );
    }
    return `data:${img.content_type};base64,${buf.toString('base64')}`;
  }
}
