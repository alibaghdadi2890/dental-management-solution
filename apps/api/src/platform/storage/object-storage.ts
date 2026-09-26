import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { RequestContext } from '../cls/request-context';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { DomainError } from '../kernel/domain-error';

export const S3 = Symbol('S3');

export class InvalidObjectKeyError extends DomainError {
  readonly code = 'storage.invalid_key';
  readonly kind = 'invalid';
}

export class ForeignObjectKeyError extends DomainError {
  readonly code = 'storage.foreign_key';
  readonly kind = 'forbidden';
}

export function createS3Client(config: AppConfig): S3Client {
  return new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT === undefined ? {} : { endpoint: config.S3_ENDPOINT }),
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    // Default flexible checksums would sign the CRC32 of an empty body into presigned PUT URLs,
    // making every browser upload fail with BadDigest.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const DEFAULT_EXPIRY_SECONDS = 300;

/**
 * S3-compatible object storage. Keys are always namespaced by tenant, and presigning refuses keys
 * outside the current tenant. Signed-URL generation is the one external call allowed inside a
 * mutating request (CLAUDE.md §9).
 */
@Injectable()
export class ObjectStorage {
  constructor(
    @Inject(S3) private readonly s3: S3Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly context: RequestContext,
  ) {}

  /** `tenants/<tenantId>/<segments...>` for the current tenant. */
  tenantKey(...segments: string[]): string {
    if (segments.length === 0 || !segments.every((segment) => SAFE_SEGMENT.test(segment))) {
      throw new InvalidObjectKeyError('Object key segments must be simple names');
    }
    return ['tenants', this.context.requireTenantId(), ...segments].join('/');
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    this.assertOwnKey(input.key);
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS },
    );
  }

  async presignDownload(input: { key: string; expiresInSeconds?: number }): Promise<string> {
    this.assertOwnKey(input.key);
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: input.key }),
      { expiresIn: input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS },
    );
  }

  private assertOwnKey(key: string): void {
    if (!key.startsWith(`tenants/${this.context.requireTenantId()}/`)) {
      throw new ForeignObjectKeyError('Object key does not belong to the current tenant');
    }
  }
}
