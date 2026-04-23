import { Link } from 'react-router-dom';
import { logout, useIdentity } from '../auth';

export default function IdentitySwitcher() {
  const id = useIdentity();
  if (!id) {
    return <Link to="/login" className="text-sm text-slate-700 hover:underline">Sign in</Link>;
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-700">
        {id.name} <span className="text-xs text-slate-400">({id.role})</span>
      </span>
      <button
        onClick={() => { logout(); window.location.href = '/login'; }}
        className="text-xs text-rose-700 hover:underline"
      >
        Sign out
      </button>
    </div>
  );
}
