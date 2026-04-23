import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { useIdentity } from '../auth';
import RequestList from '../components/RequestList';
import EmployeeAutocomplete from '../components/EmployeeAutocomplete';

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

interface Employee { id: string; name: string; email: string; role: string; managerId: string | null; createdAt: string; }

export default function AdminPage() {
  const id = useIdentity()!;
  const qc = useQueryClient();

  const [seedEmp, setSeedEmp] = useState('');
  const [seedLoc, setSeedLoc] = useState('l1');
  const [seedTotal, setSeedTotal] = useState('10');

  const [rtEmp, setRtEmp] = useState('');
  const [rtLoc, setRtLoc] = useState('l1');
  const [rtTotal, setRtTotal] = useState('10');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Employee CRUD state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'employee' | 'manager' | 'admin'>('employee');
  const [newManager, setNewManager] = useState<string>('');

  const empListQ = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => api<Employee[]>('/employees', {}, id),
  });

  const createEmpMut = useMutation({
    mutationFn: () =>
      api<Employee>('/employees', {
        method: 'POST',
        body: JSON.stringify({
          name: newName,
          email: newEmail,
          role: newRole,
          managerId: newManager || null,
        }),
      }, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setNewName(''); setNewEmail(''); setNewRole('employee'); setNewManager('');
      setErrorMsg(null);
    },
    onError: (e: any) => setErrorMsg(e instanceof ApiError ? e.body?.detail ?? e.message : String(e)),
  });

  const deleteEmpMut = useMutation({
    mutationFn: (eid: string) => api(`/employees/${eid}`, { method: 'DELETE' }, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });

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
    refetchInterval: 2000,
  });

  const forceFailMut = useMutation({
    mutationFn: (rid: string) =>
      api(`/requests/${rid}/force-fail`, { method: 'POST', body: JSON.stringify({ reason: 'admin recovery' }) }, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });

  // Convenience: seed HCM AND push to API for all employees with role=employee.
  const oneClickMut = useMutation({
    mutationFn: async () => {
      const all = await api<Employee[]>('/employees', {}, id);
      const employees = all.filter((e) => e.role === 'employee');
      for (const emp of employees) {
        await hcmAdmin('/_admin/seed', { employeeId: emp.id, locationId: 'l1', totalDays: '10' });
        await api('/hcm-webhook/realtime', {
          method: 'POST',
          body: JSON.stringify({
            employeeId: emp.id, locationId: 'l1', newTotal: '10',
            hcmTimestamp: new Date().toISOString(),
          }),
        }, id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance'] });
      setErrorMsg(null);
    },
    onError: (e: any) => setErrorMsg(e instanceof ApiError ? e.body?.detail ?? e.message : String(e)),
  });

  return (
    <div className="space-y-6">
      <section>
        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4">
          <h3 className="text-sm font-semibold text-emerald-900 mb-1">Quick demo setup</h3>
          <p className="text-xs text-emerald-800 mb-3">
            Seeds 10 days for every employee in the directory. Then any of them can log in and create requests.
          </p>
          <button
            onClick={() => oneClickMut.mutate()}
            disabled={oneClickMut.isPending}
            className="bg-emerald-700 hover:bg-emerald-800 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
          >
            {oneClickMut.isPending ? 'Setting up…' : 'Run one-click demo setup'}
          </button>
          {oneClickMut.isSuccess && (
            <p className="text-xs text-emerald-700 mt-2">Done. Log in as any employee to see their balance.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Employees</h2>
        <p className="text-xs text-slate-500 mb-2">Create employees, set their role, and link to a manager.</p>

        <form
          onSubmit={(e) => { e.preventDefault(); createEmpMut.mutate(); }}
          className="bg-white border border-slate-200 rounded-md p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end mb-4"
        >
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" required className="border border-slate-300 rounded px-2 py-1 text-sm" />
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@co.dev" required type="email" className="border border-slate-300 rounded px-2 py-1 text-sm" />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as any)} className="border border-slate-300 rounded px-2 py-1 text-sm">
            <option value="employee">employee</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
          <EmployeeAutocomplete
            value={newManager}
            onChange={setNewManager}
            employees={empListQ.data}
            rolesFilter={['manager', 'admin']}
            placeholder="Manager (search by name, optional)"
          />
          <button type="submit" disabled={createEmpMut.isPending} className="bg-slate-900 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50">
            {createEmpMut.isPending ? '…' : 'Create'}
          </button>
        </form>

        {empListQ.data && (
          <ul className="space-y-2">
            {empListQ.data.map((e) => {
              const mgr = empListQ.data?.find((x) => x.id === e.managerId);
              return (
                <li key={e.id} className="bg-white border border-slate-200 rounded-md p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{e.name} <span className="text-xs text-slate-400">{e.role}</span></div>
                    <div className="text-xs text-slate-500">{e.email}{mgr ? ` · reports to ${mgr.name}` : ''}</div>
                  </div>
                  <button
                    onClick={() => { if (confirm(`Delete ${e.name}?`)) deleteEmpMut.mutate(e.id); }}
                    className="text-xs text-rose-700 hover:underline"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">1. Seed HCM mock</h2>
        <p className="text-xs text-slate-500 mb-2">Sets initial balance in the HCM mock (server-side only — local DB not touched).</p>
        <div className="bg-white border border-slate-200 rounded-md p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <EmployeeAutocomplete
            value={seedEmp}
            onChange={setSeedEmp}
            employees={empListQ.data}
            placeholder="Employee (search by name)"
          />
          <input value={seedLoc} onChange={(e) => setSeedLoc(e.target.value)} placeholder="locationId" className="border border-slate-300 rounded px-2 py-1 text-sm" />
          <input value={seedTotal} onChange={(e) => setSeedTotal(e.target.value)} placeholder="totalDays" className="border border-slate-300 rounded px-2 py-1 text-sm" />
          <button onClick={() => seedMut.mutate()} disabled={seedMut.isPending || !seedEmp} className="bg-slate-900 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50">
            {seedMut.isPending ? '…' : 'Seed HCM'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">2. Push realtime balance to API</h2>
        <p className="text-xs text-slate-500 mb-2">Simulates HCM webhook telling the API the new total. This is what makes the balance show up in /employee.</p>
        <div className="bg-white border border-slate-200 rounded-md p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <EmployeeAutocomplete
            value={rtEmp}
            onChange={setRtEmp}
            employees={empListQ.data}
            placeholder="Employee (search by name)"
          />
          <input value={rtLoc} onChange={(e) => setRtLoc(e.target.value)} placeholder="locationId" className="border border-slate-300 rounded px-2 py-1 text-sm" />
          <input value={rtTotal} onChange={(e) => setRtTotal(e.target.value)} placeholder="newTotal" className="border border-slate-300 rounded px-2 py-1 text-sm" />
          <button onClick={() => realtimeMut.mutate()} disabled={realtimeMut.isPending || !rtEmp} className="bg-slate-900 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50">
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
