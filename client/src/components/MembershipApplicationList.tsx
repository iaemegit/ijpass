import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/auth';
import AdminPagination, { ADMIN_PAGE_SIZE, pageSlice } from './AdminPagination';
import AdminTableControls from './AdminTableControls';

type ApplicationFile = { originalName: string; size: number };
type MembershipApplication = { id: number; reference: string; status: string; createdAt: string; name: string; email: string; phone: string; affiliation: string; country: string; membershipCategory: string; message: string; photo?: ApplicationFile | null; resume?: ApplicationFile | null };
const formatSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;

export default function MembershipApplicationList() {
  const [applications, setApplications] = useState<MembershipApplication[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [downloading, setDownloading] = useState('');
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('newest');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api.get<{ applications: MembershipApplication[] }>('/admin/membership-applications', { params: query ? { q: query } : undefined })
        .then(({ data }) => setApplications(data.applications))
        .catch(() => setError('Unable to load membership applications.'))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const download = async (application: MembershipApplication, kind: 'photo' | 'resume') => {
    const key = `${application.id}-${kind}`;
    setDownloading(key); setError('');
    try {
      const { data } = await api.get<Blob>(`/admin/membership-applications/${application.id}/files/${kind}`, { responseType: 'blob' });
      const file = application[kind];
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file?.originalName || `${kind}-${application.reference}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch { setError(`Unable to download the ${kind === 'photo' ? 'photo' : 'Resume'}.`); }
    finally { setDownloading(''); }
  };

  const remove = async (application: MembershipApplication) => {
    if (!window.confirm(`Delete membership application ${application.reference} from ${application.name}? The uploaded Photo and Resume will also be deleted.`)) return;
    setDeletingId(application.id); setError('');
    try { await api.delete(`/admin/membership-applications/${application.id}`); setApplications(current => current.filter(item => item.id !== application.id)); }
    catch { setError('Unable to delete the membership application.'); }
    finally { setDeletingId(null); }
  };
  const sortedApplications = useMemo(() => [...applications].sort((first, second) => {
    const compare = (firstValue: string, secondValue: string) => firstValue.localeCompare(secondValue, undefined, { sensitivity: 'base' });
    if (sortBy === 'oldest') return new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
    if (sortBy === 'name') return compare(first.name, second.name);
    if (sortBy === 'email') return compare(first.email, second.email);
    if (sortBy === 'category') return compare(first.membershipCategory, second.membershipCategory) || compare(first.name, second.name);
    if (sortBy === 'country') return compare(first.country, second.country) || compare(first.name, second.name);
    if (sortBy === 'reference') return compare(first.reference, second.reference);
    return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
  }), [applications, sortBy]);

  return <div className="enquiry-panel enquiry-table-panel membership-applications-panel">
    <div className="enquiry-heading"><div><span className="eyebrow">Website records</span><h2>Membership Applications</h2><p>Applications submitted through the public membership form.</p></div><AdminTableControls query={query} onQueryChange={value => { setQuery(value); setPage(1); }} placeholder="Search reference, name, email, phone, affiliation, country, category, message" sort={sortBy} onSortChange={value => { setSortBy(value); setPage(1); }} options={[{value:'newest',label:'Newest first'},{value:'oldest',label:'Oldest first'},{value:'reference',label:'Reference A–Z'},{value:'name',label:'Name A–Z'},{value:'email',label:'Email A–Z'},{value:'category',label:'Category A–Z'},{value:'country',label:'Country A–Z'}]}/></div>
    {error && <div className="alert alert-danger m-3">{error}</div>}
    <div className="table-responsive"><table className="table contact-enquiry-table membership-application-table align-middle">
      <thead><tr><th>Sl. No.</th><th>Reference</th><th>Name</th><th>Email / Phone</th><th>Affiliation / Country</th><th>Category</th><th>Message</th><th>Photo</th><th>Resume</th><th>Submitted</th><th>Action</th></tr></thead>
      <tbody>
        {loading && <tr><td colSpan={11} className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2"/>Loading applications…</td></tr>}
        {!loading && !applications.length && <tr><td colSpan={11} className="text-center text-muted py-4">No membership applications found.</td></tr>}
        {!loading && pageSlice(sortedApplications, page).map((application, index) => { const words = application.message.trim().split(/\s+/); const expandable = words.length > 4; const expanded = expandedMessages.has(application.id); return <tr key={application.id}>
          <td>{(page - 1) * ADMIN_PAGE_SIZE + index + 1}</td><td><code>{application.reference}</code></td><td><b>{application.name}</b></td><td><div className="application-stacked-cell"><a href={`mailto:${application.email}`}>{application.email}</a><a href={`tel:${application.phone}`}>{application.phone}</a></div></td><td><div className="application-stacked-cell"><span>{application.affiliation}</span><small><i className="bi bi-geo-alt"/>{application.country}</small></div></td><td>{application.membershipCategory}</td><td className={`application-message-cell ${expanded ? 'expanded' : ''}`}><span>{expanded ? application.message : words.slice(0, 4).join(' ')}</span>{expandable && <button type="button" onClick={() => setExpandedMessages(current => { const next = new Set(current); if (next.has(application.id)) next.delete(application.id); else next.add(application.id); return next; })}>{expanded ? 'Show less' : 'See more...'}</button>}</td>
          <td>{application.photo ? <button className="application-file-icon" onClick={() => download(application, 'photo')} disabled={downloading === `${application.id}-photo`} title={`Download Photo: ${application.photo.originalName} (${formatSize(application.photo.size)})`} aria-label={`Download Photo for ${application.name}`}>{downloading === `${application.id}-photo` ? <span className="spinner-border spinner-border-sm"/> : <i className="bi bi-image"/>}</button> : '—'}</td>
          <td>{application.resume ? <button className="application-file-icon" onClick={() => download(application, 'resume')} disabled={downloading === `${application.id}-resume`} title={`Download Resume: ${application.resume.originalName} (${formatSize(application.resume.size)})`} aria-label={`Download Resume for ${application.name}`}>{downloading === `${application.id}-resume` ? <span className="spinner-border spinner-border-sm"/> : <i className="bi bi-file-earmark-arrow-down"/>}</button> : '—'}</td>
          <td>{new Date(application.createdAt).toLocaleString()}</td><td><button className="btn btn-sm btn-outline-danger enquiry-delete" onClick={() => remove(application)} disabled={deletingId === application.id}>{deletingId === application.id ? <span className="spinner-border spinner-border-sm"/> : <i className="bi bi-trash3"/>}</button></td>
        </tr>;})}
      </tbody>
    </table></div><AdminPagination total={sortedApplications.length} page={page} onPageChange={setPage}/>
  </div>;
}
