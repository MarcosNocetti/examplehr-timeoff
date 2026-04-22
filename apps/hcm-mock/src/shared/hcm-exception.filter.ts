import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

const STATUS_BY_CODE: Record<string, number> = {
  INSUFFICIENT_BALANCE: 409,
  INVALID_DIMENSION: 422,
  NOT_FOUND: 404,
  HCM_UNAVAILABLE: 503,
};

@Catch()
export class HcmExceptionFilter implements ExceptionFilter {
  catch(ex: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (ex instanceof HttpException) {
      const body = ex.getResponse();
      res.status(ex.getStatus()).json(typeof body === 'object' ? body : { message: body });
      return;
    }
    const e = ex as { code?: string; message?: string };
    const status = (e.code != null ? STATUS_BY_CODE[e.code] : undefined) ?? 500;
    res.status(status).json({
      title: e.message ?? 'HCM error',
      code: e.code ?? 'INTERNAL',
    });
  }
}
