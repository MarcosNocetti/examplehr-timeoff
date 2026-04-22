type Req = {
  id: string;
  employeeId: string;
  locationId: string;
  startDate: string;
  endDate: string;
  days: string;
  status: string;
  sagaState: string;
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
  CANCELLED: 'bg-slate-200 text-slate-700',
  FAILED: 'bg-rose-200 text-rose-950',
};

export default function RequestList({
  requests,
  actions,
}: {
  requests: Req[];
  actions?: (r: Req) => React.ReactNode;
}) {
  if (requests.length === 0) {
    return <p className="text-sm text-slate-500">No requests.</p>;
  }
  return (
    <ul className="space-y-2">
      {requests.map((r) => (
        <li key={r.id} className="bg-white border border-slate-200 rounded-md p-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-900">
              {r.employeeId} · {r.locationId} · {r.days}d
            </div>
            <div className="text-xs text-slate-500">
              {new Date(r.startDate).toLocaleDateString()} → {new Date(r.endDate).toLocaleDateString()}
              <span className="ml-2 text-slate-400">saga: {r.sagaState}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[r.status] ?? 'bg-slate-100'}`}>
              {r.status}
            </span>
            {actions?.(r)}
          </div>
        </li>
      ))}
    </ul>
  );
}
