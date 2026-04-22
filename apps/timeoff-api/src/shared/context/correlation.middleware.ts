import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { als } from './request-context';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = (req.headers['x-correlation-id'] as string) ?? randomUUID();
    const employeeId = req.headers['x-employee-id'] as string | undefined;
    const role = req.headers['x-role'] as string | undefined;
    res.setHeader('x-correlation-id', correlationId);
    als.run({ correlationId, employeeId, role }, () => next());
  }
}
