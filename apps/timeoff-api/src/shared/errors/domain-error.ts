export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  abstract readonly detail: string;
  constructor(message: string) { super(message); this.name = this.constructor.name; }
}
