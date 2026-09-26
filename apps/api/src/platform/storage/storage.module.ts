import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { createS3Client, ObjectStorage, S3 } from './object-storage';

@Global()
@Module({
  providers: [
    {
      provide: S3,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createS3Client(config),
    },
    ObjectStorage,
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
