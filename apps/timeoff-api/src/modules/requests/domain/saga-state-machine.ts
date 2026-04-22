import { SagaState, RequestStatus } from '@examplehr/contracts';

const ALLOWED: Record<SagaState, SagaState[]> = {
  [SagaState.RESERVING_HCM]:    [SagaState.AWAITING_APPROVAL, SagaState.TERMINAL],
  [SagaState.AWAITING_APPROVAL]:[SagaState.COMMITTING_HCM, SagaState.COMPENSATING_HCM, SagaState.TERMINAL],
  [SagaState.COMMITTING_HCM]:   [SagaState.TERMINAL],
  [SagaState.COMPENSATING_HCM]: [SagaState.TERMINAL],
  [SagaState.TERMINAL]:         [],
};

export function canTransition(from: SagaState, to: SagaState): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export type SagaAction =
  | 'hcm_reserve_ok'
  | 'hcm_reserve_4xx'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'hcm_confirm_ok'
  | 'hcm_compensate_ok'
  | 'force_fail';

export interface NextResult { saga: SagaState; request: RequestStatus; }

export function nextStatus(input: { action: SagaAction; current: SagaState }): NextResult {
  const { action, current } = input;
  switch (action) {
    case 'hcm_reserve_ok':
      if (current !== SagaState.RESERVING_HCM) throw new Error(`Bad transition for ${action} from ${current}`);
      return { saga: SagaState.AWAITING_APPROVAL, request: RequestStatus.PENDING_APPROVAL };
    case 'hcm_reserve_4xx':
      return { saga: SagaState.TERMINAL, request: RequestStatus.FAILED };
    case 'approve':
      if (current !== SagaState.AWAITING_APPROVAL) throw new Error(`Bad transition for ${action} from ${current}`);
      return { saga: SagaState.COMMITTING_HCM, request: RequestStatus.PENDING_APPROVAL };
    case 'reject':
      if (current !== SagaState.AWAITING_APPROVAL) throw new Error(`Bad transition for ${action} from ${current}`);
      return { saga: SagaState.COMPENSATING_HCM, request: RequestStatus.PENDING_APPROVAL };
    case 'cancel':
      if (current !== SagaState.AWAITING_APPROVAL) throw new Error(`Bad transition for ${action} from ${current}`);
      return { saga: SagaState.COMPENSATING_HCM, request: RequestStatus.PENDING_APPROVAL };
    case 'hcm_confirm_ok':
      return { saga: SagaState.TERMINAL, request: RequestStatus.APPROVED };
    case 'hcm_compensate_ok':
      // The intended terminal status (REJECTED vs CANCELLED) is determined
      // by the caller (RequestsService.reject vs cancel) at action time and
      // passed to the worker via outbox payload. Here we default to CANCELLED.
      return { saga: SagaState.TERMINAL, request: RequestStatus.CANCELLED };
    case 'force_fail':
      return { saga: SagaState.TERMINAL, request: RequestStatus.FAILED };
  }
}
