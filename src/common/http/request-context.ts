import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

export interface CorrelatedRequest extends Request {
  requestId?: string;
}

export function requestContext(logger = new Logger('HTTP')) {
  return (
    request: CorrelatedRequest,
    response: Response,
    next: NextFunction,
  ) => {
    const supplied = request.get('x-request-id');
    const requestId =
      supplied && /^[A-Za-z0-9_-]{1,64}$/.test(supplied)
        ? supplied
        : randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    const start = performance.now();
    response.once('finish', () => {
      // Allowlist metadata: never log URLs, headers, payloads or error objects.
      logger.log(
        JSON.stringify({
          event: 'http.request',
          requestId,
          method: request.method,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - start),
        }),
      );
    });
    next();
  };
}
