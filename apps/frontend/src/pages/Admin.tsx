import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { useIdentity } from '../auth';
import RequestList from '../components/RequestList';

// IPv4 — see comment in api.ts about Docker Desktop / browser localhost issue.
const HCM_ADMIN_BASE = (import.meta as any).env?.VITE_HCM_URL ?? 'http://127.0.0.1:4000';

async function hcmAdmin(path: string, body: any) {
  const res = await fetch(`${HCM_ADMIN_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HCM admin ${res.status}`);
}

export default function AdminPage() {
  const id = useIdentity();
  const qc = useQueryClient();

  const [seedEmp, setSeedEmp] = useState('e1');
  const [seedLoc, setSeedLoc] = useState('l1');
  const [seedTotal, setSeedTotal] = useState('10');

  const [rtEmp, setRtEmp] = useState('e1');
  const [rtLoc, setRtLoc] = useState('l1');
  const [rtTotal, setRtTotal] = useState('10');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const seedMut = useMutation({
    mutationFn: async () => {
      await hcmAdmin('/_admin/seed', { employeeId: seedEmp, locationId: seedLoc, totalDays: seedTotal });
    },
    onSuccess: () => setErrorMsg(null),
    onError: (e: any) => setErrorMsg(String(e)),
  });

  const realtimeMut = useMutation({
    mutationFn: () =>
      api('/hcm-webhook/realtime', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: rtEmp,
          locationId: rtLoc,
          newTotal: rtTotal,
          hcmTimestamp: new Date().toISOString(),
        }),
      }, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance'] });
      setErrorMsg(null);
    },
    onError: (e: any) => setErrorMsg(e instanceof ApiError ? e.body?.detail ?? e.message : String(e)),
  });

  const reqQ = useQuery({
    queryKey: ['requests', 'all'],
    queryFn: () => api<any[]>(`/requests`, {}, id),
    enabled: id.role === 'admin',
    refetchInterval: 2000,
  });

  const forceFailMut = useMutation({
    mutationFn: (rid: string) =>
      api(`/requests/${rid}/force-fail`, { method: 'POST', body: JSON.stringify({ reason: 'admin recovery' }) }, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });

  // Convenience: seed HCM AND push to API for two demo employees with one click.
  const oneClickMut = useMutation({
    mutationFn: async () => {
      const setup = async (employeeId: string, totalDays: string) => {
        await hcmAdmin('/_admin/seed', { employeeId, locationId: 'l1', totalDays });
        await api('/hcm-webhook/realtime', {
          method: 'POST',
          body: JSON.stringify({
            employeeId,
            locationId: 'l1',
            newTotal: totalDays,
            hcmTimestamp: new Date().toISOString(),
          }),
        }, id);
      };
      await setup('e1', '10');
      await setup('e2', '15');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance'] });
      setErrorMsg(null);
    },
    onError: (e: any) => setErrorMsg(e instanceof ApiError ? e.body?.detail ?? e.message : String(e)),
  });

  if (id.role !== 'admin') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
        <p className="text-sm text-amber-900">
          Switch to <strong>Admin</strong> in the top-right dropdown to use this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4">
          <h3 className="text-sm font-semibold text-emerald-900 mb-1">Quick demo setup</h3>
          <p className="text-xs text-emerald-800 mb-3">
            Seeds HCM + pushes balances to the API for <code className="bg-emerald-100 px-1 rounded">e1</code> (10 days)
            and <code className="bg-emerald-100 px-1 rounded">e2</code> (15 days). Then switch to the Employee page.
          </p>
          <button
            onClick={() => oneClickMut.mutate()}
            disabled={oneClickMut.isPending}
            className="bg-emerald-700 hover:bg-emerald-800 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
          >
            {oneClickMut.isPending ? 'Setting up…' : 'Run one-click demo setup'}
          </button>
          {oneClickMut.isSuccess && (
            <p className="text-xs text-emerald-700 mt-2">✓ Done. Switch to Employee (e1 or e2) to see balances.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">1. Seed HCM mock</h2>
        <p className="text-xs text-slate-500 mb-2">Sets initial balance in the HCM mock (server-side only — local DB not touched).</p>
        <div className="bg-white border border-slate-200 rounded-md p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <input value={seedEmp} onChange={(e) => setSeedEmp(e.target.value)} placeholder="employeeId" className="border border-slate-300 rounded px-2 py-1" />
          <input value={seedLoc} onChange={(e) => setSeedLoc(e.target.value)} placeholder="locationId" className="border border-slate-300 rounded px-2 py-1" />
          <input value={seedTotal} onChange={(e) => setSeedTotal(e.target.value)} placeholder="totalDays" className="border border-slate-300 rounded px-2 py-1" />
          <button onClick={() => seedMut.mutate()} disabled={seedMut.isPending} className="bg-slate-900 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50">
            {seedMut.isPending ? '…' : 'Seed HCM'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">2. Push realtime balance to API</h2>
        <p className="text-xs text-slate-500 mb-2">Simulates HCM webhook telling the API the new total. This is what makes the balance show up in /employee.</p>
        <div className="bg-white border border-slate-200 rounded-md p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <input value={rtEmp} onChange={(e) => setRtEmp(e.target.value)} placeholder="employeeId" className="border border-slate-300 rounded px-2 py-1" />
          <input value={rtLoc} onChange={(e) => setRtLoc(e.target.value)} placeholder="locationId" className="border border-slate-300 rounded px-2 py-1" />
          <input value={rtTotal} onChange={(e) => setRtTotal(e.target.value)} placeholder="newTotal" className="border border-slate-300 rounded px-2 py-1" />
          <button onClick={() => realtimeMut.mutate()} disabled={realtimeMut.isPending} className="bg-slate-900 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50">
            {realtimeMut.isPending ? '…' : 'Push to API'}
          </button>
        </div>
      </section>

      {errorMsg && <p className="text-sm text-rose-600">{errorMsg}</p>}

      <section>
        <h2 className="text-lg font-semibold mb-2">All requests</h2>
        {reqQ.data && (
          <RequestList
            requests={reqQ.data}
            actions={(r) =>
              r.sagaState !== 'TERMINAL' ? (
                <button
                  onClick={() => forceFailMut.mutate(r.id)}
                  className="text-xs bg-amber-600 text-white px-3 py-1 rounded"
                >
                  Force-fail
                </button>
              ) : null
            }
          />
        )}
      </section>
    </div>
  );
}
