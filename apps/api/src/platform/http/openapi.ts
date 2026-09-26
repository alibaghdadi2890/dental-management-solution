import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export const OPENAPI_PATH = 'api/v1/docs';

/**
 * OpenAPI generated from the `@dcm/contracts` Zod schemas behind the DTOs (CLAUDE.md §12).
 * Served outside production only; the document itself is the contract, not the UI.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Dental Clinic Management API')
    .setVersion('1')
    .addCookieAuth('dcm.session_token')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(OPENAPI_PATH, app, cleanupOpenApiDoc(document));
}
