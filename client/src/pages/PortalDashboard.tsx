import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api, clearSession, type PortalUser } from '../lib/auth';
import AdminWorkspace from '../components/AdminWorkspace';

export default function PortalDashboard({ publisher = false }: { publisher?: boolean }) {
  const user = useOutletContext<PortalUser>();
  const navigate = useNavigate();
  const [summary, setSummary] = useState({ users: 0, journals: 0, applications: 0, messages: 0 });
  useEffect(() => { if (!publisher) api.get('/admin/summary').then(({ data }) => setSummary(data)).catch(() => undefined); }, [publisher]);
  const logout = () => { clearSession(); navigate(publisher ? '/login/publishers' : '/admin/login'); };
  const cards = publisher ? [
    ['bi-journals','My Journals','Manage registered journal records'],['bi-file-earmark-text','Applications','View submissions and their status'],['bi-graph-up-arrow','Performance','Review available journal analytics']
  ] : [
    ['bi-people','Users',String(summary.users)],['bi-journals','Journals',String(summary.journals)],['bi-file-earmark-check','Applications',String(summary.applications)],['bi-envelope','Enquiries',String(summary.messages)]
  ];
  if (!publisher && user.role === 'SUPER_ADMIN') return <AdminWorkspace user={user} summary={summary} logout={logout}/>;
  return <section className="portal-page"><div className="container"><div className="portal-top"><div><span className="eyebrow">{publisher ? 'Publisher workspace' : 'Administration & data entry'}</span><h1>Welcome, {user.name}</h1><p>{user.email} · {user.role.replace('_',' ')}</p></div><button className="btn btn-outline-secondary" onClick={logout}><i className="bi bi-box-arrow-right me-2"/>Sign out</button></div><div className="portal-grid">{cards.map(([icon,title,value])=><div className="portal-card" key={title}><i className={`bi ${icon}`}/><div><span>{title}</span><strong>{value}</strong></div></div>)}</div><div className="portal-notice"><i className="bi bi-info-circle"/><div><h3>{publisher ? 'Publisher tools are ready for the next module' : 'Secure data-entry dashboard'}</h3><p>{publisher ? 'Journal forms, application history, and publisher-profile management can now be added to this authenticated workspace.' : 'Your account is authenticated and role-protected. Data-entry modules can now be added based on the permissions you assign to internal users.'}</p></div></div></div></section>;
}
