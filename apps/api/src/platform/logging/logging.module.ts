import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { pinoHttpOptions } from './pino-options';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ pinoHttp: pinoHttpOptions(config) }),
    }),
  ],
})
export class LoggingModule {}
