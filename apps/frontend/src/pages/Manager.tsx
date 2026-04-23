import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useIdentity } from '../auth';
import RequestList from '../components/RequestList';

interface TeamMember { id: string; name: string; email: string; role: string; }

export default function ManagerPage() {
  const id = useIdentity()!;
  const qc = useQueryClient();

  const teamQ = useQuery({
    queryKey: ['team', id.id],
    queryFn: () => api<TeamMember[]>('/employees/team', {}, id),
  });

  const reqQ = useQuery({
    queryKey: ['requests', 'pending'],
    queryFn: () => api<any[]>(`/requests?status=PENDING_APPROVAL`, {}, id),
    refetchInterval: 2000,
  });

  const approveMut = useMutation({
    mutationFn: (rid: string) => api(`/requests/${rid}/approve`, { method: 'POST' }, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });
  const rejectMut = useMutation({
    mutationFn: (rid: string) =>
      api(`/requests/${rid}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'no' }) }, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-2">My team</h2>
        {teamQ.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {teamQ.data && teamQ.data.length === 0 && (
          <p className="text-sm text-slate-500">No direct reports yet.</p>
        )}
        {teamQ.data && teamQ.data.length > 0 && (
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {teamQ.data.map((t) => (
              <li key={t.id} className="bg-white border border-slate-200 rounded-md p-3">
                <div className="text-sm font-medium text-slate-900">{t.name}</div>
                <div className="text-xs text-slate-500">{t.email}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Pending approvals</h2>
        {reqQ.data && (
          <RequestList
            requests={reqQ.data.filter((r) => r.sagaState === 'AWAITING_APPROVAL')}
            actions={(r) => (
              <div className="flex gap-2">
                <button
                  onClick={() => approveMut.mutate(r.id)}
                  disabled={approveMut.isPending}
                  className="text-xs bg-emerald-600 text-white px-3 py-1 rounded disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => rejectMut.mutate(r.id)}
                  disabled={rejectMut.isPending}
                  className="text-xs bg-rose-600 text-white px-3 py-1 rounded disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          />
        )}
      </section>
    </div>
  );
}
