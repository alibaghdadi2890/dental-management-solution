import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { ObjectStorage, S3 } from './object-storage';

@Global()
@Module({
  providers: [
    {
      provide: S3,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new S3Client({
          region: config.S3_REGION,
          ...(config.S3_ENDPOINT === undefined ? {} : { endpoint: config.S3_ENDPOINT }),
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
          credentials: {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          },
        }),
    },
    ObjectStorage,
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
