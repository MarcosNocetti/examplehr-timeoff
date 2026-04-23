// REQUIRES: `docker compose up -d --wait` to be run BEFORE this test.
// Verify the stack is up first: curl http://localhost:3000/health
// To run: pnpm --filter timeoff-api test:smoke

const API = process.env.API_URL ?? 'http://localhost:3000';
const HCM = process.env.HCM_URL ?? 'http://localhost:4000';

const employee = (id = 'e1') => ({
  'x-employee-id': id,
  'x-role': 'employee',
  'content-type': 'application/json',
});
const manager = () => ({
  'x-employee-id': 'm1',
  'x-role': 'manager',
  'content-type': 'application/json',
});
const admin = () => ({
  'x-employee-id': 'admin',
  'x-role': 'admin',
  'content-type': 'application/json',
});

async function waitFor<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, ms = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (predicate(v)) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return fn();
}

// Each smoke run uses a unique employeeId so docker volume state from prior runs
// can't pollute the test. The hcm-mock _admin/reset clears its in-memory state.
const SMOKE_EMPLOYEE = `smoke-${Date.now()}`;
const LOCATION = 'l1';

describe('Full flow smoke', () => {
  beforeAll(async () => {
    const health = await fetch(`${API}/health`).catch(() => null);
    if (!health || health.status !== 200) {
      throw new Error(`API not reachable at ${API}. Run "docker compose up -d --wait" first.`);
    }
    const hcmHealth = await fetch(`${HCM}/_admin/reset`, { method: 'POST' }).catch(() => null);
    if (!hcmHealth || hcmHealth.status !== 204) {
      throw new Error(`HCM mock not reachable at ${HCM}.`);
    }
  });

  it('seed → create → approve → balance reflects', async () => {
    // 1. Seed HCM with 10 days for the unique smoke employee
    await fetch(`${HCM}/_admin/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId: SMOKE_EMPLOYEE, locationId: LOCATION, totalDays: '10' }),
    }).then((r) => expect(r.status).toBe(204));

    // 2. Push initial balance to local via realtime webhook
    await fetch(`${API}/hcm-webhook/realtime`, {
      method: 'POST',
      headers: admin(),
      body: JSON.stringify({
        employeeId: SMOKE_EMPLOYEE,
        locationId: LOCATION,
        newTotal: '10',
        hcmTimestamp: new Date().toISOString(),
      }),
    }).then((r) => expect(r.status).toBe(200));

    // 3. Verify initial balance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const initial: any[] = await fetch(`${API}/balances/${SMOKE_EMPLOYEE}`, { headers: employee(SMOKE_EMPLOYEE) }).then((r) => r.json() as Promise<any[]>);
    expect(initial[0]?.totalDays).toBe('10');
    expect(initial[0]?.availableDays).toBe('10');

    // 4. Create a 3-day request as the smoke employee
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created: any = await fetch(`${API}/requests`, {
      method: 'POST',
      headers: employee(SMOKE_EMPLOYEE),
      body: JSON.stringify({
        locationId: LOCATION,
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        idempotencyKey: `${SMOKE_EMPLOYEE}-req`,
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).then((r) => r.json() as Promise<any>);
    expect(created.id).toBeDefined();

    // 5. Wait for outbox dispatcher + worker to process the RESERVE_HCM
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reserved: any = await waitFor(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => fetch(`${API}/requests/${created.id}`, { headers: employee(SMOKE_EMPLOYEE) }).then((r) => r.json() as Promise<any>),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req: any) => req.sagaState === 'AWAITING_APPROVAL',
      15000,
    );
    expect(reserved.sagaState).toBe('AWAITING_APPROVAL');

    // 6. After reserve: 10 total, 7 available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const afterReserve: any[] = await fetch(`${API}/balances/${SMOKE_EMPLOYEE}`, { headers: employee(SMOKE_EMPLOYEE) }).then((r) => r.json() as Promise<any[]>);
    expect(afterReserve[0]?.availableDays).toBe('7');

    // 7. Admin approves (admin bypasses the manager team-membership check —
    //    the smoke test uses a synthetic employeeId that isn't in the Employee
    //    table, so no real manager is linked to it)
    await fetch(`${API}/requests/${created.id}/approve`, {
      method: 'POST',
      headers: admin(),
    }).then((r) => expect([200, 201]).toContain(r.status));

    // 8. Wait for confirm to land — request becomes APPROVED
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const approved: any = await waitFor(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => fetch(`${API}/requests/${created.id}`, { headers: employee(SMOKE_EMPLOYEE) }).then((r) => r.json() as Promise<any>),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req: any) => req.status === 'APPROVED',
      15000,
    );
    expect(approved.status).toBe('APPROVED');
    expect(approved.sagaState).toBe('TERMINAL');

    // 9. Final balance: 7 days remain (3 consumed by HCM)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const final: any[] = await fetch(`${API}/balances/${SMOKE_EMPLOYEE}`, { headers: employee(SMOKE_EMPLOYEE) }).then((r) => r.json() as Promise<any[]>);
    expect(final[0]?.totalDays).toBe('7');
    expect(final[0]?.availableDays).toBe('7');
  }, 60000);
});
