import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import EmployeePage from './pages/Employee';
import ManagerPage from './pages/Manager';
import AdminPage from './pages/Admin';
import LoginPage from './pages/Login';
import IdentitySwitcher from './components/IdentitySwitcher';
import ErrorBoundary from './components/ErrorBoundary';
import RequireAuth from './components/RequireAuth';
import { useIdentity } from './auth';

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
  const id = useIdentity();
  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">ExampleHR Time-Off</span>
            {id && (
              <nav className="ml-4 flex gap-1">
                <NavLink to="/employee" label="Employee" />
                {(id.role === 'manager' || id.role === 'admin') && <NavLink to="/manager" label="Manager" />}
                {id.role === 'admin' && <NavLink to="/admin" label="Admin" />}
              </nav>
            )}
          </div>
          <IdentitySwitcher />
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Navigate to={id ? '/employee' : '/login'} replace />} />
            <Route
              path="/employee"
              element={<RequireAuth><EmployeePage /></RequireAuth>}
            />
            <Route
              path="/manager"
              element={<RequireAuth roles={['manager', 'admin']}><ManagerPage /></RequireAuth>}
            />
            <Route
              path="/admin"
              element={<RequireAuth roles={['admin']}><AdminPage /></RequireAuth>}
            />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
