import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReconciliationService } from '../modules/reconciliation/reconciliation.service';

@Injectable()
export class ReconcileBatchProcessor {
  constructor(private readonly svc: ReconciliationService) {}

  async process(job: Job): Promise<void> {
    if (job.name !== 'RECONCILE_BATCH') return;
    await this.svc.applyChunk(job.data.rows);
  }
}
