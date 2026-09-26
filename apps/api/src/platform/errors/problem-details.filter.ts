import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequestContext } from '../cls/request-context';
import { pathOnly } from '../logging/log-fields';
import { toProblemDetails } from './problem-details';

/** The one place exceptions become HTTP responses (CLAUDE.md §12). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(private readonly context: RequestContext) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const problem = toProblemDetails(exception, this.context.requestId);

    if (problem.status >= 500) {
      this.logger.error({ err: exception }, 'Unhandled error');
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .json({ ...problem, instance: pathOnly(request.originalUrl) });
  }
}
