import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { api, clearSession, getToken, type PortalUser } from '../lib/auth';

export default function ProtectedRoute({ roles }: { roles: PortalUser['role'][] }) {
  const [state, setState] = useState<{ loading: boolean; user?: PortalUser }>({ loading: true });
  useEffect(() => {
    if (!getToken()) { setState({ loading: false }); return; }
    api.get<{ user: PortalUser }>('/auth/me').then(({ data }) => setState({ loading: false, user: data.user })).catch(() => { clearSession(); setState({ loading: false }); });
  }, []);
  if (state.loading) return <div className="portal-loading"><div className="spinner-border text-success"/><span>Verifying secure session…</span></div>;
  if (!state.user) return <Navigate to="/admin/login" replace/>;
  if (!roles.includes(state.user.role)) return <Navigate to={state.user.role === 'PUBLISHER' ? '/publisher' : '/admin'} replace/>;
  return <Outlet context={state.user}/>;
}
