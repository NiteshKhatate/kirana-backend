import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { CorrelatedRequest } from './request-context';

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest>();
    const response = context.getResponse<Response>();
    const candidate =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const statusCode = candidate >= 400 && candidate <= 599 ? candidate : 500;
    const message = STATUS_CODES[statusCode] ?? 'Internal Server Error';
    const requestId = request.requestId ?? randomUUID();
    response.setHeader('x-request-id', requestId);
    response.status(statusCode).json({
      statusCode,
      error: message,
      message,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
