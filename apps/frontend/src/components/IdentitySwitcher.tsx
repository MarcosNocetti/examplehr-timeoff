import { setIdentity, useIdentity, Identity } from '../auth';

const PRESETS: Array<{ label: string; id: Identity }> = [
  { label: 'Employee e1', id: { employeeId: 'e1', role: 'employee' } },
  { label: 'Employee e2', id: { employeeId: 'e2', role: 'employee' } },
  { label: 'Manager m1', id: { employeeId: 'm1', role: 'manager' } },
  { label: 'Admin', id: { employeeId: 'admin', role: 'admin' } },
];

export default function IdentitySwitcher() {
  const id = useIdentity();
  const current = `${id.employeeId}|${id.role}`;
  return (
    <select
      className="text-sm border border-slate-300 rounded-md px-2 py-1 bg-white"
      value={current}
      onChange={(e) => {
        const found = PRESETS.find((p) => `${p.id.employeeId}|${p.id.role}` === e.target.value);
        if (found) setIdentity(found.id);
      }}
    >
      {PRESETS.map((p) => (
        <option key={`${p.id.employeeId}|${p.id.role}`} value={`${p.id.employeeId}|${p.id.role}`}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
