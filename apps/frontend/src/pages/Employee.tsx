import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { useIdentity } from '../auth';
import RequestList from '../components/RequestList';

type Balance = { employeeId: string; locationId: string; totalDays: string; availableDays: string; version: number; hcmLastSeenAt: string };
type Req = any;

export default function EmployeePage() {
  const id = useIdentity();
  const qc = useQueryClient();
  const balQ = useQuery({
    queryKey: ['balance', id.employeeId],
    queryFn: () => api<Balance[]>(`/balances/${id.employeeId}`, {}, id),
    enabled: id.role === 'employee',
  });
  const reqQ = useQuery({
    queryKey: ['requests', id.employeeId, 'mine'],
    queryFn: () => api<Req[]>(`/requests`, {}, id),
    enabled: id.role === 'employee',
    refetchInterval: 2000,
  });

  const [locationId, setLocationId] = useState('l1');
  const [startDate, setStartDate] = useState('2026-05-01');
  const [endDate, setEndDate] = useState('2026-05-03');
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      api<Req>('/requests', {
        method: 'POST',
        body: JSON.stringify({
          locationId,
          startDate,
          endDate,
          idempotencyKey: `${id.employeeId}-${Date.now()}`,
        }),
      }, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests', id.employeeId] });
      qc.invalidateQueries({ queryKey: ['balance', id.employeeId] });
      setError(null);
    },
    onError: (e: any) => setError(e instanceof ApiError ? e.body?.detail ?? e.message : String(e)),
  });

  const cancelMut = useMutation({
    mutationFn: (rid: string) => api(`/requests/${rid}/cancel`, { method: 'POST' }, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests', id.employeeId] });
      qc.invalidateQueries({ queryKey: ['balance', id.employeeId] });
    },
  });

  if (id.role !== 'employee') {
    return <p className="text-slate-600">Switch to an employee identity to use this page.</p>;
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-2">My balance</h2>
        {balQ.isLoading && <p>Loading...</p>}
        {balQ.error && <p className="text-rose-600 text-sm">No balance yet — admin must seed via /admin</p>}
        {balQ.data && balQ.data.length === 0 && <p className="text-sm text-slate-500">No balance yet — admin must seed via /admin.</p>}
        {balQ.data && balQ.data.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {balQ.data.map((b) => (
              <div key={`${b.employeeId}|${b.locationId}`} className="bg-white border border-slate-200 rounded-md p-4">
                <div className="text-xs text-slate-500">{b.locationId}</div>
                <div className="text-2xl font-semibold">{b.availableDays} <span className="text-sm text-slate-500">/ {b.totalDays} days</span></div>
                <div className="text-xs text-slate-400 mt-1">v{b.version} · last hcm: {new Date(b.hcmLastSeenAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">New request</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}
          className="bg-white border border-slate-200 rounded-md p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">Location</span>
            <input value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">Start date</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">End date</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1" />
          </label>
          <button
            type="submit"
            disabled={createMut.isPending}
            className="bg-slate-900 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
          >
            {createMut.isPending ? 'Submitting…' : 'Submit'}
          </button>
        </form>
        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">My requests</h2>
        {reqQ.data && (
          <RequestList
            requests={reqQ.data}
            actions={(r) =>
              r.status === 'PENDING_APPROVAL' && r.sagaState === 'AWAITING_APPROVAL' ? (
                <button
                  onClick={() => cancelMut.mutate(r.id)}
                  className="text-xs text-rose-700 hover:underline"
                >
                  Cancel
                </button>
              ) : null
            }
          />
        )}
      </section>
    </div>
  );
}
