import { Global, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../src/platform/config/config.module';
import type { AppConfig } from '../../src/platform/config/config.schema';
import { createS3Client, ObjectStorage, S3 } from '../../src/platform/storage/object-storage';

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

/** The first bytes a real file of each accepted extension starts with. */
const STARTS: Readonly<Record<string, Uint8Array>> = {
  jpg: Uint8Array.of(0xff, 0xd8, 0xff, 0xe0),
  png: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  pdf: ascii('%PDF-1.7'),
  txt: ascii('plain text'),
};

/** What a file named `filename` starts with (`jpg`, `png`, `pdf` or `txt`; else a JPEG). */
export function sampleStart(filename: string): Uint8Array {
  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  return STARTS[extension === 'jpeg' ? 'jpg' : extension] ?? Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);
}

interface FakeObject {
  sizeBytes: number;
  start: Uint8Array;
}

/**
 * Object storage without a bucket: keys and signed URLs are the real ones (signing is local), and
 * `head`, `readStart`, `copy` and `remove` answer from a map a test fills with `put`, as a browser
 * upload would.
 */
@Injectable()
export class FakeObjectStorage extends ObjectStorage {
  private readonly objects = new Map<string, FakeObject>();

  /** An object of `sizeBytes` that starts with `start` (a JPEG's first bytes by default). */
  put(key: string, sizeBytes: number, start: Uint8Array = sampleStart('a.jpg')): void {
    this.objects.set(key, { sizeBytes, start });
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  /** Every key that starts with `prefix`. */
  keysUnder(prefix: string): string[] {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }

  /** Runs once, right after the next copy: where a test lets another request overtake a Save. */
  afterNextCopy: (() => Promise<void>) | undefined;

  /** The first bytes stored under `key`, read by a test (no tenant needed). */
  startOf(key: string): Uint8Array | undefined {
    return this.objects.get(key)?.start;
  }

  override head(key: string): Promise<{ sizeBytes: number } | null> {
    this.assertOwnKey(key);
    const object = this.objects.get(key);
    return Promise.resolve(object ? { sizeBytes: object.sizeBytes } : null);
  }

  override readStart(key: string, bytes: number): Promise<Uint8Array | null> {
    this.assertOwnKey(key);
    return Promise.resolve(this.objects.get(key)?.start.subarray(0, bytes) ?? null);
  }

  override async copy(fromKey: string, toKey: string): Promise<boolean> {
    this.assertOwnKey(fromKey);
    this.assertOwnKey(toKey);
    const object = this.objects.get(fromKey);
    if (object) this.objects.set(toKey, object);
    const overtake = this.afterNextCopy;
    this.afterNextCopy = undefined;
    await overtake?.();
    return object !== undefined;
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
