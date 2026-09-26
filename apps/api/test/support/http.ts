import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/** supertest agent for a Nest app, typed (getHttpServer() returns any). */
export function http(app: INestApplication) {
  return request(app.getHttpServer() as Server);
}
