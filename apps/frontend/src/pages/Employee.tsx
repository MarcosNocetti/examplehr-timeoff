import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { useIdentity } from '../auth';
import RequestList from '../components/RequestList';

interface Balance {
  employeeId: string; locationId: string; totalDays: string; availableDays: string; version: number; hcmLastSeenAt: string;
}
interface Me { id: string; name: string; role: string; managerId: string | null; }

type Req = any;

export default function EmployeePage() {
  const id = useIdentity()!;  // RequireAuth guarantees non-null
  const qc = useQueryClient();

  const meQ = useQuery({
    queryKey: ['me', id.id],
    queryFn: () => api<Me>('/employees/me', {}, id),
  });

  // Fetch the manager's name if any — only admins can read /employees/:id directly
  const managerQ = useQuery({
    queryKey: ['employee', meQ.data?.managerId],
    queryFn: () => api<any>(`/employees/${meQ.data!.managerId}`, {}, id).catch(() => null),
    enabled: !!meQ.data?.managerId && id.role === 'admin',
  });

  const balQ = useQuery({
    queryKey: ['balance', id.id],
    queryFn: () => api<Balance[]>(`/balances/${id.id}`, {}, id),
  });

  const reqQ = useQuery({
    queryKey: ['requests', id.id, 'mine'],
    queryFn: () => api<Req[]>(`/requests`, {}, id),
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
          idempotencyKey: `${id.id}-${Date.now()}`,
        }),
      }, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests', id.id] });
      qc.invalidateQueries({ queryKey: ['balance', id.id] });
      setError(null);
    },
    onError: (e: any) => setError(e instanceof ApiError ? e.body?.detail ?? e.message : String(e)),
  });

  const cancelMut = useMutation({
    mutationFn: (rid: string) => api(`/requests/${rid}/cancel`, { method: 'POST' }, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests', id.id] });
      qc.invalidateQueries({ queryKey: ['balance', id.id] });
    },
  });

  return (
    <div className="space-y-6">
      {meQ.data?.managerId && (
        <div className="text-sm text-slate-600">
          My manager:{' '}
          <strong>
            {managerQ.data?.name ?? `id: ${meQ.data.managerId.slice(0, 8)}…`}
          </strong>
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-2">My balance</h2>
        {balQ.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {(balQ.error || (balQ.data && balQ.data.length === 0)) && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-900 space-y-2">
            <p><strong>No balance yet for {id.name}.</strong></p>
            <p>
              Balances live in the HCM system (the "source of truth"). To bootstrap demo data:
            </p>
            <ol className="list-decimal list-inside text-xs space-y-1">
              <li>Log in as <strong>Admin</strong></li>
              <li>Click <strong>"Run one-click demo setup"</strong> (seeds all employees with 10 days)</li>
              <li>Switch back to this page — the balance will appear</li>
            </ol>
          </div>
        )}
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
