import { S3Client } from '@aws-sdk/client-s3';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import type { AppClsStore } from '../cls/app-cls-store';
import { MissingTenantContextError, RequestContext } from '../cls/request-context';
import type { AppConfig } from '../config/config.schema';
import { ForeignObjectKeyError, InvalidObjectKeyError, ObjectStorage } from './object-storage';

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://localhost:9000',
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test-secret' },
});
const storage = new ObjectStorage(s3, { S3_BUCKET: 'dcm-test' } as AppConfig, context);

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

  it('refuses to presign another tenant key', async () => {
    await expect(
      inTenant('tenant-a', () =>
        storage.presignDownload({ key: 'tenants/tenant-b/imports/batch-1.csv' }),
      ),
    ).rejects.toBeInstanceOf(ForeignObjectKeyError);
  });
});
