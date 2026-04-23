import { Navigate, useLocation } from 'react-router-dom';
import { useIdentity, Role } from '../auth';

export default function RequireAuth({
  children,
  roles,
}: {
  children: React.ReactNode;
  roles?: Role[];
}) {
  const id = useIdentity();
  const loc = useLocation();
  if (!id) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(id.role)) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-900">
        <p><strong>Access denied.</strong></p>
        <p className="text-xs mt-1">
          This page requires role: <strong>{roles.join(' or ')}</strong>. You're logged in as <strong>{id.role}</strong>.
        </p>
        <p className="mt-2"><a href="/login" className="text-amber-700 underline">Log in as someone else</a></p>
      </div>
    );
  }
  return <>{children}</>;
}
