import { Params } from 'nestjs-pino';
import { currentCtx } from '../context/request-context';

const fromAls = () => {
  const ctx = currentCtx();
  return ctx ? { correlationId: ctx.correlationId, employeeId: ctx.employeeId, role: ctx.role } : {};
};

export const pinoConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
        ? undefined
        : { target: 'pino-pretty' },
    customProps: () => fromAls(),
    // mixin runs for every log line (not just the HTTP summary), so
    // all logger.log() calls inside controllers/services pick up ALS context.
    mixin: () => fromAls(),
    redact: ['req.headers.authorization'],
  },
};
