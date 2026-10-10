import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import type { AppClsStore } from '../cls/app-cls-store';
import { MissingTenantContextError, RequestContext } from '../cls/request-context';
import type { AppConfig } from '../config/config.schema';
import {
  contentDisposition,
  createS3Client,
  ForeignObjectKeyError,
  InvalidObjectKeyError,
  ObjectStorage,
} from './object-storage';

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
const config = {
  S3_REGION: 'us-east-1',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_FORCE_PATH_STYLE: true,
  S3_BUCKET: 'dcm-test',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test-secret',
} as AppConfig;
const storage = new ObjectStorage(createS3Client(config), config, context);

const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
  context.run({ requestId: 'req-00000001', actorKind: 'user', tenantId }, fn);

describe('ObjectStorage', () => {
  it('namespaces keys by the current tenant', async () => {
    const key = await inTenant('tenant-a', async () => storage.tenantKey('imports', 'batch-1.csv'));
    expect(key).toBe('tenants/tenant-a/imports/batch-1.csv');
  });

  it.each(['..', '../x', 'a/b', '', '.hidden'])('rejects unsafe segment %j', async (segment) => {
    await expect(
      inTenant('tenant-a', async () => storage.tenantKey('imports', segment)),
    ).rejects.toBeInstanceOf(InvalidObjectKeyError);
  });

  it('requires a tenant', () => {
    expect(() => storage.tenantKey('imports')).toThrow(MissingTenantContextError);
  });

  it('presigns uploads for own keys', async () => {
    const url = await inTenant('tenant-a', () =>
      storage.presignUpload({
        key: 'tenants/tenant-a/imports/batch-1.csv',
        contentType: 'text/csv',
      }),
    );
    expect(url).toMatch(
      /^http:\/\/localhost:9000\/dcm-test\/tenants\/tenant-a\/imports\/batch-1\.csv\?/,
    );
    expect(url).toContain('X-Amz-Expires=300');
  });

  it('does not pin an empty-body checksum into presigned uploads', async () => {
    // Regression: SDK default checksums signed CRC32 of an empty body, so real uploads failed.
    const url = await inTenant('tenant-a', () =>
      storage.presignUpload({ key: 'tenants/tenant-a/imports/a.csv', contentType: 'text/csv' }),
    );
    expect(url).not.toMatch(/x-amz-checksum|x-amz-sdk-checksum-algorithm/i);
  });

  it('refuses to presign another tenant key', async () => {
    await expect(
      inTenant('tenant-a', () =>
        storage.presignDownload({ key: 'tenants/tenant-b/imports/batch-1.csv' }),
      ),
    ).rejects.toBeInstanceOf(ForeignObjectKeyError);
  });

  it('presigns a download with the name and type the browser should use', async () => {
    const url = await inTenant('tenant-a', () =>
      storage.presignDownload({
        key: 'tenants/tenant-a/files/f1/original',
        contentType: 'application/pdf',
        disposition: { type: 'attachment', filename: 'referral.pdf' },
        expiresInSeconds: 60,
      }),
    );
    expect(url).toContain('X-Amz-Expires=60');
    expect(url).toContain('response-content-type=application%2Fpdf');
    expect(url).toContain('response-content-disposition=attachment');
  });

  it("refuses to read or copy another tenant's object, or to copy into its keys", async () => {
    const foreign = 'tenants/tenant-b/files/f1/original';
    const own = 'tenants/tenant-a/files/f1/original';
    await expect(inTenant('tenant-a', () => storage.readStart(foreign, 16))).rejects.toBeInstanceOf(
      ForeignObjectKeyError,
    );
    await expect(inTenant('tenant-a', () => storage.copy(foreign, own))).rejects.toBeInstanceOf(
      ForeignObjectKeyError,
    );
    await expect(inTenant('tenant-a', () => storage.copy(own, foreign))).rejects.toBeInstanceOf(
      ForeignObjectKeyError,
    );
  });

  it("refuses to look at or delete another tenant's object", async () => {
    await expect(
      inTenant('tenant-a', () => storage.head('tenants/tenant-b/files/f1/original')),
    ).rejects.toBeInstanceOf(ForeignObjectKeyError);
    await expect(
      inTenant('tenant-a', () => storage.remove(['tenants/tenant-b/files/f1/original'])),
    ).rejects.toBeInstanceOf(ForeignObjectKeyError);
  });
});

describe('contentDisposition', () => {
  it('keeps a plain name and encodes one that is not ASCII', () => {
    expect(contentDisposition({ type: 'inline', filename: 'pano.jpg' })).toBe(
      `inline; filename="pano.jpg"; filename*=UTF-8''pano.jpg`,
    );
    expect(contentDisposition({ type: 'attachment', filename: 'صورة "1".png' })).toBe(
      `attachment; filename="____ _1_.png"; filename*=UTF-8''%D8%B5%D9%88%D8%B1%D8%A9%20%221%22.png`,
    );
  });
});
