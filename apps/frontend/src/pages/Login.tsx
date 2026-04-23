import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { setIdentity } from '../auth';

interface DirectoryEntry { id: string; name: string; role: 'employee' | 'manager' | 'admin'; }

const ROLE_BADGE: Record<string, string> = {
  employee: 'bg-sky-100 text-sky-900',
  manager: 'bg-violet-100 text-violet-900',
  admin: 'bg-rose-100 text-rose-900',
};

export default function LoginPage() {
  const nav = useNavigate();
  const dirQ = useQuery({
    queryKey: ['employees', 'directory'],
    queryFn: () => api<DirectoryEntry[]>('/employees/directory'),
  });

  const pickIdentity = (e: DirectoryEntry) => {
    setIdentity({ id: e.id, name: e.name, role: e.role });
    // Send each role to a sensible landing page
    if (e.role === 'admin') nav('/admin');
    else if (e.role === 'manager') nav('/manager');
    else nav('/employee');
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Sign in</h1>
      <p className="text-sm text-slate-500 mb-6">
        Demo: pick an identity to impersonate. (In production, a gateway would handle auth and
        forward <code>x-employee-id</code> + <code>x-role</code> headers; the service does not
        own credentials.)
      </p>

      {dirQ.isLoading && <p className="text-sm text-slate-500">Loading employees…</p>}
      {dirQ.error && (
        <div className="bg-rose-50 border border-rose-200 rounded-md p-4 text-sm text-rose-900">
          Failed to load directory. Is the API up at <code>http://127.0.0.1:3000</code>?
        </div>
      )}

      {dirQ.data && dirQ.data.length === 0 && (
        <p className="text-sm text-slate-500">No employees yet — restart the api container to trigger the seed.</p>
      )}

      {dirQ.data && dirQ.data.length > 0 && (
        <ul className="space-y-2">
          {dirQ.data.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => pickIdentity(e)}
                className="w-full text-left bg-white border border-slate-200 hover:border-slate-400 rounded-md p-4 flex items-center justify-between"
              >
                <span>
                  <span className="font-medium text-slate-900">{e.name}</span>
                  <span className="ml-2 text-xs text-slate-400">id: {e.id.slice(0, 8)}…</span>
                </span>
                <span className={`text-xs px-2 py-1 rounded ${ROLE_BADGE[e.role]}`}>{e.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
