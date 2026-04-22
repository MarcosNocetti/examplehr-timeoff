import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response, Request } from 'express';
import { DomainError } from './domain-error';
import { currentCtx } from '../context/request-context';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(GlobalExceptionFilter.name);
  catch(ex: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const headerStr = (h: string | string[] | undefined): string | undefined =>
      Array.isArray(h) ? h[0] : h;
    const correlationId =
      currentCtx()?.correlationId
      ?? headerStr(req.headers['x-correlation-id'])
      ?? 'n/a';

    if (ex instanceof DomainError) {
      if (ex.httpStatus >= 500) {
        this.log.error(`[${ex.code}] ${ex.message} correlationId=${correlationId}`);
      }
      res.status(ex.httpStatus).json({
        type: `https://examplehr/errors/${ex.code.toLowerCase().replace(/_/g, '-')}`,
        title: ex.message,
        detail: ex.detail,
        code: ex.code,
        correlationId,
      });
      return;
    }
    if (ex instanceof HttpException) {
      const body = ex.getResponse();
      res.status(ex.getStatus()).json({
        ...(typeof body === 'object' ? body : { message: body }),
        correlationId,
      });
      return;
    }
    this.log.error('Unhandled exception', ex as Error);
    res.status(500).json({
      type: 'https://examplehr/errors/internal',
      title: 'Internal server error',
      code: 'INTERNAL',
      correlationId,
    });
  }
}
