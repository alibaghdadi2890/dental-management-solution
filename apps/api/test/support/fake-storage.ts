import { Global, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../src/platform/config/config.module';
import type { AppConfig } from '../../src/platform/config/config.schema';
import { createS3Client, ObjectStorage, S3 } from '../../src/platform/storage/object-storage';

/**
 * Object storage without a bucket: keys and signed URLs are the real ones (signing is local), and
 * `head` / `remove` answer from a map a test fills with `put`, as a browser upload would.
 */
@Injectable()
export class FakeObjectStorage extends ObjectStorage {
  private readonly objects = new Map<string, number>();

  put(key: string, sizeBytes: number): void {
    this.objects.set(key, sizeBytes);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  override head(key: string): Promise<{ sizeBytes: number } | null> {
    this.assertOwnKey(key);
    const sizeBytes = this.objects.get(key);
    return Promise.resolve(sizeBytes === undefined ? null : { sizeBytes });
  }

  override remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.assertOwnKey(key);
      this.objects.delete(key);
    }
    return Promise.resolve();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: S3,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createS3Client(config),
    },
    FakeObjectStorage,
    { provide: ObjectStorage, useExisting: FakeObjectStorage },
  ],
  exports: [ObjectStorage, FakeObjectStorage],
})
export class FakeStorageModule {}
