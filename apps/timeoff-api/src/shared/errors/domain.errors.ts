import { DomainError } from './domain-error';

export class InsufficientBalanceError extends DomainError {
  readonly code = 'INSUFFICIENT_BALANCE';
  readonly httpStatus = 409;
  readonly detail: string;
  constructor(public readonly ctx: { available: number | string; requested: number | string }) {
    super(`Insufficient balance: available=${ctx.available}, requested=${ctx.requested}`);
    this.detail = `Available ${ctx.available} day(s); requested ${ctx.requested}.`;
  }
}

export class InvalidStateTransitionError extends DomainError {
  readonly code = 'INVALID_STATE_TRANSITION';
  readonly httpStatus = 409;
  readonly detail: string;
  constructor(from: string, to: string) {
    super(`Cannot transition ${from} -> ${to}`);
    this.detail = `Illegal saga transition from ${from} to ${to}.`;
  }
}

/**
 * Thrown when a request with an existing idempotencyKey is submitted again.
 * The HTTP filter responds with 200 (NOT a 4xx) because the contract is
 * idempotent-replay: the caller gets back the prior result, not an error.
 * Any catch-block that aggregates DomainError for alerting should explicitly
 * skip this class.
 */
export class DuplicateIdempotencyKeyError extends DomainError {
  readonly code = 'DUPLICATE_IDEMPOTENCY_KEY';
  readonly httpStatus = 200;
  readonly detail = 'Returning existing request with same idempotencyKey.';
  constructor() { super('Duplicate idempotency key'); }
}

export class HcmProtocolViolationError extends DomainError {
  readonly code = 'HCM_PROTOCOL_VIOLATION';
  readonly httpStatus = 502;
  readonly detail: string;
  constructor(message: string) { super(message); this.detail = message; }
}

export class HcmUnavailableError extends DomainError {
  readonly code = 'HCM_UNAVAILABLE';
  readonly httpStatus = 503;
  readonly detail = 'HCM is currently unreachable; will retry.';
  constructor(message = 'HCM unavailable') { super(message); }
}

export class OptimisticLockError extends DomainError {
  readonly code = 'OPTIMISTIC_LOCK';
  readonly httpStatus = 409;
  readonly detail = 'Concurrent update detected; please retry.';
  constructor() { super('Optimistic lock conflict'); }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  readonly detail: string;
  constructor(what: string) { super(`${what} not found`); this.detail = `${what} not found.`; }
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  readonly detail = 'Operation not allowed for current role.';
  constructor() { super('Forbidden'); }
}
