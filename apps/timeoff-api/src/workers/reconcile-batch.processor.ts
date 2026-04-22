import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ReconciliationService } from '../modules/reconciliation/reconciliation.service';

@Processor('hcm-saga', { concurrency: 4 })
export class ReconcileBatchProcessor extends WorkerHost {
  constructor(private readonly svc: ReconciliationService) {
    super();
  }
  async process(job: Job): Promise<void> {
    if (job.name !== 'RECONCILE_BATCH') return;
    await this.svc.applyChunk(job.data.rows);
  }
}
