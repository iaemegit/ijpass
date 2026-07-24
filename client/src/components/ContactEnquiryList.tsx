import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/auth';
import AdminPagination, { ADMIN_PAGE_SIZE, pageSlice } from './AdminPagination';

type Enquiry = { id: number; name: string; email: string; organization?: string | null; country?: string | null; message: string; createdAt: string };

export default function ContactEnquiryList() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('newest');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api.get<{ enquiries: Enquiry[] }>('/admin/contact-enquiries', { params: query ? { q: query } : undefined })
        .then(({ data }) => setEnquiries(data.enquiries))
        .catch(() => setError('Unable to load contact enquiries.'))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const remove = async (enquiry: Enquiry) => {
    if (!window.confirm(`Delete the enquiry from ${enquiry.name}? This cannot be undone.`)) return;
    setDeletingId(enquiry.id); setError('');
    try { await api.delete(`/admin/contact-enquiries/${enquiry.id}`); setEnquiries(current => current.filter(item => item.id !== enquiry.id)); }
    catch { setError('Unable to delete the contact enquiry.'); }
    finally { setDeletingId(null); }
  };
  const sortedEnquiries = useMemo(() => [...enquiries].sort((first, second) => {
    const compare = (firstValue?: string | null, secondValue?: string | null) => (firstValue || '').localeCompare(secondValue || '', undefined, { sensitivity: 'base' });
    if (sortBy === 'oldest') return new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
    if (sortBy === 'name') return compare(first.name, second.name);
    if (sortBy === 'email') return compare(first.email, second.email);
    if (sortBy === 'company') return compare(first.organization, second.organization) || compare(first.name, second.name);
    if (sortBy === 'country') return compare(first.country, second.country) || compare(first.name, second.name);
    return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
  }), [enquiries, sortBy]);

  return <div className="enquiry-panel enquiry-table-panel">
    <div className="enquiry-heading">
      <div><span className="eyebrow">Website records</span><h2>Contact Enquiries</h2><p>Messages submitted through the public contact form.</p></div>
      <div className="enquiry-table-controls"><div className="enquiry-search"><i className="bi bi-search"/><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search name, email, company, country" aria-label="Search by name, email, company, or country"/></div><select className="form-select form-select-sm" value={sortBy} onChange={event => { setSortBy(event.target.value); setPage(1); }} aria-label="Sort contact enquiries"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option><option value="email">Email A–Z</option><option value="company">Company A–Z</option><option value="country">Country A–Z</option></select></div>
    </div>
    {error && <div className="alert alert-danger m-3">{error}</div>}
    <div className="table-responsive">
      <table className="table contact-enquiry-table align-middle">
        <thead><tr><th>Sl. No.</th><th>Name</th><th>Email</th><th>Company</th><th>Country</th><th>Message</th><th>Action</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={7} className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2"/>Loading enquiries…</td></tr>}
          {!loading && !enquiries.length && <tr><td colSpan={7} className="text-center text-muted py-4">No contact enquiries found.</td></tr>}
          {!loading && pageSlice(sortedEnquiries, page).map((enquiry, index) => <tr key={enquiry.id}>
            <td>{(page - 1) * ADMIN_PAGE_SIZE + index + 1}</td>
            <td><b>{enquiry.name}</b></td>
            <td><a href={`mailto:${enquiry.email}`}>{enquiry.email}</a></td>
            <td>{enquiry.organization || '—'}</td>
            <td>{enquiry.country || '—'}</td>
            <td className="message-cell">{enquiry.message}</td>
            <td><button className="btn btn-sm btn-outline-danger enquiry-delete" onClick={()=>remove(enquiry)} disabled={deletingId===enquiry.id}>{deletingId===enquiry.id?<span className="spinner-border spinner-border-sm"/>:<i className="bi bi-trash3"/>}</button></td>
          </tr>)}
        </tbody>
      </table>
    </div><AdminPagination total={sortedEnquiries.length} page={page} onPageChange={setPage}/>
  </div>;
}
