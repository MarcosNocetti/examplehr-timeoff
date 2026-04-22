import { Injectable } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';

@Injectable()
export class OutboxService {
  constructor(private readonly repo: OutboxRepository) {}
  enqueueInTx(tx: any, aggregateId: string, eventType: string, payload: unknown) {
    return this.repo.create({ aggregateId, eventType, payload, tx });
  }
}
