import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { als } from './request-context';

function firstValue(h: string | string[] | undefined): string | undefined {
  return Array.isArray(h) ? h[0] : h;
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = firstValue(req.headers['x-correlation-id']) ?? randomUUID();
    const employeeId = firstValue(req.headers['x-employee-id']);
    const role = firstValue(req.headers['x-role']);
    res.setHeader('x-correlation-id', correlationId);
    als.run({ correlationId, employeeId, role }, () => next());
  }
}
