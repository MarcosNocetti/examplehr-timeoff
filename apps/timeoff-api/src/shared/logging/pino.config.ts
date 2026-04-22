import { Params } from 'nestjs-pino';
import { currentCtx } from '../context/request-context';

export const pinoConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test' ? undefined : { target: 'pino-pretty' },
    customProps: () => {
      const ctx = currentCtx();
      return ctx ? { correlationId: ctx.correlationId, employeeId: ctx.employeeId, role: ctx.role } : {};
    },
    redact: ['req.headers.authorization'],
  },
};
