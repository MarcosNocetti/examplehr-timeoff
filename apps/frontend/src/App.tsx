import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import EmployeePage from './pages/Employee';
import ManagerPage from './pages/Manager';
import AdminPage from './pages/Admin';
import IdentitySwitcher from './components/IdentitySwitcher';

function NavLink({ to, label }: { to: string; label: string }) {
  const { pathname } = useLocation();
  const active = pathname === to;
  return (
    <Link
      to={to}
      className={`px-3 py-2 rounded-md text-sm font-medium ${
        active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200'
      }`}
    >
      {label}
    </Link>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">ExampleHR Time-Off</span>
            <nav className="ml-4 flex gap-1">
              <NavLink to="/employee" label="Employee" />
              <NavLink to="/manager" label="Manager" />
              <NavLink to="/admin" label="Admin" />
            </nav>
          </div>
          <IdentitySwitcher />
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/employee" replace />} />
          <Route path="/employee" element={<EmployeePage />} />
          <Route path="/manager" element={<ManagerPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}
