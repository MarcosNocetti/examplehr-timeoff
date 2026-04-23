import { useEffect, useMemo, useRef, useState } from 'react';

interface EmployeeLike {
  id: string;
  name: string;
  role?: string;
}

interface Props {
  value: string;                  // current selected employeeId (empty string = none)
  onChange: (id: string) => void; // called with the selected id (or '' to clear)
  employees: EmployeeLike[] | undefined;
  placeholder?: string;
  /** When provided, also filter the list to only these roles. */
  rolesFilter?: string[];
  className?: string;
}

const ROLE_BADGE: Record<string, string> = {
  employee: 'bg-sky-100 text-sky-900',
  manager: 'bg-violet-100 text-violet-900',
  admin: 'bg-rose-100 text-rose-900',
};

/**
 * Search-as-you-type employee picker. The user never sees the id —
 * they search by name, click an option, and we store the id internally
 * for the API call.
 */
export default function EmployeeAutocomplete({
  value, onChange, employees, placeholder = 'Search by name…', rolesFilter, className,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => employees?.find((e) => e.id === value),
    [employees, value],
  );

  // When the selected employee changes from the outside (e.g., reset), reflect it.
  useEffect(() => {
    if (selected) setQuery('');
  }, [selected]);

  const matches = useMemo(() => {
    if (!employees) return [];
    const filtered = rolesFilter
      ? employees.filter((e) => e.role && rolesFilter.includes(e.role))
      : employees;
    const q = query.trim().toLowerCase();
    if (!q) return filtered.slice(0, 10);
    return filtered
      .filter((e) => e.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [employees, query, rolesFilter]);

  // Click-outside to close
  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pick = (id: string) => {
    onChange(id);
    setQuery('');
    setOpen(false);
    setHighlight(0);
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
      setOpen(true);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (ev.key === 'Enter') {
      if (open && matches[highlight]) {
        ev.preventDefault();
        pick(matches[highlight].id);
      }
    } else if (ev.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      {selected ? (
        <div className="flex items-center justify-between border border-slate-300 rounded px-2 py-1 text-sm bg-white">
          <span className="truncate">
            <span className="font-medium text-slate-900">{selected.name}</span>
            {selected.role && (
              <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${ROLE_BADGE[selected.role] ?? 'bg-slate-100'}`}>
                {selected.role}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onChange('')}
            className="ml-2 text-slate-400 hover:text-rose-600"
            aria-label="Clear selection"
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
            autoComplete="off"
          />
          {open && matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-md max-h-64 overflow-auto">
              {matches.map((e, idx) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onMouseDown={(ev) => { ev.preventDefault(); pick(e.id); }}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                      idx === highlight ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-slate-900">{e.name}</span>
                    {e.role && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${ROLE_BADGE[e.role] ?? 'bg-slate-100'}`}>
                        {e.role}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open && query && matches.length === 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-md p-2 text-xs text-slate-500">
              No matches for "{query}"
            </div>
          )}
        </>
      )}
    </div>
  );
}
