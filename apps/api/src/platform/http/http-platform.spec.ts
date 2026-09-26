import { Body, Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createZodDto } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppClsModule } from '../cls/cls.module';
import { DomainError } from '../kernel/domain-error';
import { requestIdMiddleware } from '../logging/request-id';
import { HttpPlatformModule } from './http-platform.module';

class SampleNotFound extends DomainError {
  readonly code = 'sample.not_found';
  readonly kind = 'not_found';
}

class CreateSampleDto extends createZodDto(z.object({ name: z.string().min(1) })) {}

@Controller('samples')
class SampleController {
  @Get('missing')
  missing(): never {
    throw new SampleNotFound('Sample s1 does not exist');
  }

  @Get('boom')
  boom(): never {
    throw new Error('connection string postgres://secret');
  }

  @Post()
  create(@Body() body: CreateSampleDto): CreateSampleDto {
    return body;
  }
}

describe('HTTP platform', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppClsModule, HttpPlatformModule],
      controllers: [SampleController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(requestIdMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders domain errors as problem details with the request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/samples/missing')
      .set('x-request-id', 'client-req-0001');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.headers['x-request-id']).toBe('client-req-0001');
    expect(response.body).toMatchObject({
      code: 'sample.not_found',
      detail: 'Sample s1 does not exist',
      requestId: 'client-req-0001',
      instance: '/samples/missing',
    });
  });

  it('validates bodies with Zod and reports field errors', async () => {
    const response = await request(app.getHttpServer()).post('/samples').send({ name: '' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'validation_failed',
      errors: [expect.objectContaining({ path: 'name', code: 'too_small' })],
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('accepts valid bodies', async () => {
    const response = await request(app.getHttpServer()).post('/samples').send({ name: 'Ok' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ name: 'Ok' });
  });

  it('never leaks internal error messages', async () => {
    const response = await request(app.getHttpServer()).get('/samples/boom');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('internal_error');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});
