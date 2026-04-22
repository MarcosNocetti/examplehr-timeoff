import { HcmHttpAdapter } from '../../../src/modules/hcm-client/hcm-http.adapter';
import { spawn, ChildProcess } from 'child_process';
import { setTimeout as wait } from 'timers/promises';
import * as http from 'http';

async function waitReady(url: string, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (r) => {
          if (r.statusCode && r.statusCode < 500) resolve(); else reject(new Error(`status ${r.statusCode}`));
        });
        req.on('error', reject);
      });
      return;
    } catch {
      await wait(300);
    }
  }
  throw new Error('mock not ready');
}

const PORT = '4101';
const BASE = `http://localhost:${PORT}`;

describe('HcmHttpAdapter (integration with mock)', () => {
  let proc: ChildProcess;

  beforeAll(async () => {
    proc = spawn('pnpm', ['--filter', 'hcm-mock', 'start'], {
      env: { ...process.env, PORT },
      stdio: 'pipe',
      shell: true,
    });
    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', () => {});
    await waitReady(`${BASE}/hcm/balances/x/y`);
  }, 30000);

  afterAll(async () => {
    if (proc?.pid) {
      // On Windows, killing pnpm only kills the wrapper; we need taskkill for the tree.
      const { exec } = require('child_process');
      await new Promise<void>((resolve) => {
        if (process.platform === 'win32') {
          exec(`taskkill /pid ${proc.pid} /f /t`, () => resolve());
        } else {
          proc.kill('SIGTERM');
          resolve();
        }
      });
    }
  });

  beforeEach(async () => {
    await fetch(`${BASE}/_admin/reset`, { method: 'POST' });
  });

  it('round-trips reserve + confirm, decrementing balance', async () => {
    const adapter = new HcmHttpAdapter(BASE);
    await fetch(`${BASE}/_admin/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId: 'e1', locationId: 'l1', totalDays: '10' }),
    });
    await adapter.reserve({ employeeId: 'e1', locationId: 'l1', days: '3', reservationId: 'r1' });
    await adapter.confirm({ reservationId: 'r1' });
    const bal = await adapter.getBalance('e1', 'l1');
    expect(bal.totalDays).toBe('7');
  }, 15000);

  it('throws HcmUnavailableError when mock injects unavailable', async () => {
    const adapter = new HcmHttpAdapter(BASE);
    await fetch(`${BASE}/_admin/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId: 'e1', locationId: 'l1', totalDays: '10' }),
    });
    await fetch(`${BASE}/_admin/inject-failure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'reserve', kind: 'unavailable' }),
    });
    await expect(adapter.reserve({ employeeId: 'e1', locationId: 'l1', days: '1', reservationId: 'r2' }))
      .rejects.toMatchObject({ code: 'HCM_UNAVAILABLE' });
  }, 15000);

  it('throws structured error for HCM 4xx (insufficient balance)', async () => {
    const adapter = new HcmHttpAdapter(BASE);
    await fetch(`${BASE}/_admin/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId: 'e1', locationId: 'l1', totalDays: '2' }),
    });
    await expect(adapter.reserve({ employeeId: 'e1', locationId: 'l1', days: '5', reservationId: 'r3' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  }, 15000);
});
