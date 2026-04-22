import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useIdentity } from '../auth';
import RequestList from '../components/RequestList';

export default function ManagerPage() {
  const id = useIdentity();
  const qc = useQueryClient();
  const reqQ = useQuery({
    queryKey: ['requests', 'pending'],
    queryFn: () => api<any[]>(`/requests?status=PENDING_APPROVAL`, {}, id),
    enabled: id.role === 'manager' || id.role === 'admin',
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

  if (id.role !== 'manager' && id.role !== 'admin') {
    return <p className="text-slate-600">Switch to manager to use this page.</p>;
  }

  return (
    <div>
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
    </div>
  );
}
