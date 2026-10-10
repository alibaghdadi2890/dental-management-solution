import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

/** How a download is offered: shown in the browser, or saved under `filename`. */
export interface ObjectDisposition {
  type: 'inline' | 'attachment';
  filename: string;
}

/**
 * `Content-Disposition` with an ASCII fallback and the RFC 5987 form, so a name in Arabic or with
 * quotes survives the header.
 */
export function contentDisposition({ type, filename }: ObjectDisposition): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const DEFAULT_EXPIRY_SECONDS = 300;

/**
 * S3-compatible object storage. Keys are always namespaced by tenant, and every call refuses keys
 * outside the current tenant. Signed-URL generation is the one external call allowed inside a
 * mutating request (CLAUDE.md §9); `head`, `readStart`, `copy` and `remove` are for the `files`
 * module, outside its transactions (ADR-0039, ADR-0041).
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

  /** `contentType` and `disposition` override what the object is served with. */
  async presignDownload(input: {
    key: string;
    expiresInSeconds?: number;
    contentType?: string;
    disposition?: ObjectDisposition;
  }): Promise<string> {
    this.assertOwnKey(input.key);
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: input.key,
        ...(input.contentType === undefined ? {} : { ResponseContentType: input.contentType }),
        ...(input.disposition === undefined
          ? {}
          : { ResponseContentDisposition: contentDisposition(input.disposition) }),
      }),
      { expiresIn: input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS },
    );
  }

  /** The stored object's size, or null when nothing was uploaded under `key`. */
  async head(key: string): Promise<{ sizeBytes: number } | null> {
    this.assertOwnKey(key);
    try {
      const object = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      );
      return { sizeBytes: object.ContentLength ?? 0 };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** The first `bytes` bytes of the stored object (fewer when it is shorter), or null when
   * nothing is stored under `key`. */
  async readStart(key: string, bytes: number): Promise<Uint8Array | null> {
    this.assertOwnKey(key);
    try {
      const object = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.config.S3_BUCKET,
          Key: key,
          Range: `bytes=0-${String(bytes - 1)}`,
        }),
      );
      return (await object.Body?.transformToByteArray()) ?? new Uint8Array();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Copies an object of the current tenant to another of its keys, inside the store; false
   * when nothing is stored under `fromKey`. */
  async copy(fromKey: string, toKey: string): Promise<boolean> {
    this.assertOwnKey(fromKey);
    this.assertOwnKey(toKey);
    try {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.config.S3_BUCKET,
          Key: toKey,
          CopySource: `${this.config.S3_BUCKET}/${fromKey}`,
        }),
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /** Deletes objects of the current tenant; a key with no object is not an error. */
  async remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.assertOwnKey(key);
    await Promise.all(
      keys.map((key) =>
        this.s3.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key })),
      ),
    );
  }

  protected assertOwnKey(key: string): void {
    if (!key.startsWith(`tenants/${this.context.requireTenantId()}/`)) {
      throw new ForeignObjectKeyError('Object key does not belong to the current tenant');
    }
  }
}
