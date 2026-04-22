import { HcmInMemoryAdapter } from '../../../src/modules/hcm-client/hcm-in-memory.adapter';

describe('HcmInMemoryAdapter', () => {
  let hcm: HcmInMemoryAdapter;
  beforeEach(() => { hcm = new HcmInMemoryAdapter(); });

  it('rejects reserve when balance insufficient', async () => {
    hcm.seed('e1', 'l1', '5');
    await expect(hcm.reserve({ employeeId: 'e1', locationId: 'l1', days: '6', reservationId: 'r1' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  });

  it('reserves, confirms, decreases total', async () => {
    hcm.seed('e1', 'l1', '10');
    await hcm.reserve({ employeeId: 'e1', locationId: 'l1', days: '3', reservationId: 'r1' });
    await hcm.confirm({ reservationId: 'r1' });
    expect((await hcm.getBalance('e1', 'l1')).totalDays).toBe('7');
  });

  it('release returns days to total when not yet confirmed', async () => {
    hcm.seed('e1', 'l1', '10');
    await hcm.reserve({ employeeId: 'e1', locationId: 'l1', days: '3', reservationId: 'r1' });
    await hcm.release({ reservationId: 'r1' });
    expect((await hcm.getBalance('e1', 'l1')).totalDays).toBe('10');
  });

  it('respects injected failure mode', async () => {
    hcm.seed('e1', 'l1', '10');
    hcm.injectFailure({ op: 'reserve', kind: 'unavailable' });
    await expect(hcm.reserve({ employeeId: 'e1', locationId: 'l1', days: '1', reservationId: 'r1' }))
      .rejects.toMatchObject({ code: 'HCM_UNAVAILABLE' });
  });
});
