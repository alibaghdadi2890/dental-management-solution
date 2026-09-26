import { Global, Module } from '@nestjs/common';
import type { Request } from 'express';
import { ClsModule } from 'nestjs-cls';
import { REQUEST_ID_HEADER } from '../logging/request-id';
import { RequestContext } from './request-context';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        // The header has already been sanitised (or generated) by `requestIdMiddleware`.
        idGenerator: (req: Request) => String(req.headers[REQUEST_ID_HEADER]),
        setup: (cls) => {
          cls.set('actorKind', 'user');
          cls.set('platformAdmin', false);
        },
      },
    }),
  ],
  providers: [RequestContext],
  exports: [RequestContext],
})
export class AppClsModule {}
