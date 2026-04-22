import { canTransition, nextStatus } from '../../../src/modules/requests/domain/saga-state-machine';
import { SagaState, RequestStatus } from '@examplehr/contracts';

describe('Saga state machine', () => {
  it('allows RESERVING_HCM → AWAITING_APPROVAL on HCM ack', () => {
    expect(canTransition(SagaState.RESERVING_HCM, SagaState.AWAITING_APPROVAL)).toBe(true);
  });

  it('rejects RESERVING_HCM → COMMITTING_HCM (skip)', () => {
    expect(canTransition(SagaState.RESERVING_HCM, SagaState.COMMITTING_HCM)).toBe(false);
  });

  it('TERMINAL is sticky', () => {
    expect(canTransition(SagaState.TERMINAL, SagaState.RESERVING_HCM)).toBe(false);
  });

  it('approval picks COMMITTING_HCM next', () => {
    expect(nextStatus({ action: 'approve', current: SagaState.AWAITING_APPROVAL })).toEqual({
      saga: SagaState.COMMITTING_HCM,
      request: RequestStatus.PENDING_APPROVAL,
    });
  });

  it('hcm_reserve_ok from RESERVING_HCM moves to AWAITING_APPROVAL/PENDING_APPROVAL', () => {
    expect(nextStatus({ action: 'hcm_reserve_ok', current: SagaState.RESERVING_HCM })).toEqual({
      saga: SagaState.AWAITING_APPROVAL,
      request: RequestStatus.PENDING_APPROVAL,
    });
  });

  it('hcm_reserve_4xx terminates as FAILED', () => {
    expect(nextStatus({ action: 'hcm_reserve_4xx', current: SagaState.RESERVING_HCM })).toEqual({
      saga: SagaState.TERMINAL,
      request: RequestStatus.FAILED,
    });
  });

  it('approve from non-AWAITING_APPROVAL throws', () => {
    expect(() => nextStatus({ action: 'approve', current: SagaState.RESERVING_HCM })).toThrow();
  });
});
