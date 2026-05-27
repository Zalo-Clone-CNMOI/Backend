import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { S3Service } from '@libs/s3';
import type { AiZaiImageRef } from '@libs/contracts';
import type { LlmContentPart } from '../ai-gateway/interfaces';

const DEFAULT_MAX_IMAGES = 4;

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

    const parts: LlmContentPart[] = [];
    for (const img of candidates) {
      try {
        const url = this.config.zaiVisionInlineBase64
          ? await this.toBase64DataUrl(img)
          : (await this.s3.presignDownload(img.key)).downloadUrl;
        parts.push({ type: 'image_url', url, mime_type: img.content_type });
      } catch (err) {
        this.logger.warn(
          `[${traceId ?? 'none'}] Failed to resolve Zai image ${img.key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return parts;
  }

  private async toBase64DataUrl(img: AiZaiImageRef): Promise<string> {
    const buf = await this.s3.download(img.key);
    return `data:${img.content_type};base64,${buf.toString('base64')}`;
  }
}
