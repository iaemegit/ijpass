import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/auth';
import AdminPagination, { ADMIN_PAGE_SIZE, pageSlice } from './AdminPagination';
import AdminTableControls from './AdminTableControls';

const schema = z.object({
  journalId: z.string().regex(/^\d+$/, 'Enter a valid journal ID'),
  journalTitle: z.string().trim().min(2, 'Enter the resource title').max(255),
  abbreviation: z.string().trim().max(100),
  printIssn: z.string().trim().max(20),
  onlineIssn: z.string().trim().max(20),
  subjectArea: z.string().trim().max(255),
  sourceType: z.string().trim().min(2, 'Enter the resource type').max(50),
  publisherId: z.string().regex(/^\d+$/, 'Select a publisher'),
  indexedFromYear: z.string().refine(value => !value || /^\d{4}$/.test(value), 'Enter a four-digit year'),
  website: z.string().trim().refine(value => !value || /^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(value), 'Enter a valid website'),
  email: z.string().trim().max(500)
});
type Values = z.infer<typeof schema>;
type Source = { id: number; journalId: number; journalTitle: string; abbreviation: string | null; printIssn: string | null; onlineIssn: string | null; subjectArea: string | null; sourceType: string; publisherId: number | null; publisher: string | null; indexedFromYear: number | null; website: string | null; email: string | null; articleCount: number; citationCount: number };
type PublisherOption = { id: number; publisherName: string };
const emptyValues: Values = { journalId: '', journalTitle: '', abbreviation: '', printIssn: '', onlineIssn: '', subjectArea: '', sourceType: 'Journal', publisherId: '', indexedFromYear: '', website: '', email: '' };

export default function SourceManager({ mode = 'list' }: { mode?: 'list' | 'form' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sources, setSources] = useState<Source[]>([]);
  const [publishers, setPublishers] = useState<PublisherOption[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: emptyValues });

  const load = useCallback(() => {
    setLoading(true); setRequestError('');
    return api.get<{ sources: Source[] }>('/admin/sources').then(({ data }) => setSources(data.sources)).catch(() => setRequestError('Unable to load the resource list.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.get<{ publishers: PublisherOption[] }>('/admin/journal-publishers').then(({ data }) => setPublishers(data.publishers)).catch(() => setRequestError('Unable to load publisher options.')); }, []);
  useEffect(() => {
    if (mode !== 'form') return;
    const editId = Number(new URLSearchParams(location.search).get('edit'));
    const source = sources.find(item => item.id === editId);
    if (source) {
      setEditingId(source.id);
      reset({ journalId: String(source.journalId), journalTitle: source.journalTitle, abbreviation: source.abbreviation || '', printIssn: source.printIssn || '', onlineIssn: source.onlineIssn || '', subjectArea: source.subjectArea || '', sourceType: source.sourceType || 'Journal', publisherId: source.publisherId ? String(source.publisherId) : '', indexedFromYear: source.indexedFromYear ? String(source.indexedFromYear) : '', website: source.website || '', email: source.email || '' });
    } else { setEditingId(null); reset(emptyValues); }
  }, [location.search, mode, reset, sources]);
  useEffect(() => setPage(1), [query, sortBy]);

  const visibleSources = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const filtered = sources.filter(source => !search || [source.id, source.journalId, source.journalTitle, source.abbreviation, source.printIssn, source.onlineIssn, source.subjectArea, source.sourceType, source.publisher, source.indexedFromYear, source.website, source.email].some(value => String(value || '').toLocaleLowerCase().includes(search)));
    return [...filtered].sort((a, b) => sortBy === 'title' ? a.journalTitle.localeCompare(b.journalTitle, undefined, { sensitivity: 'base' }) : sortBy === 'publisher' ? (a.publisher || '').localeCompare(b.publisher || '', undefined, { sensitivity: 'base' }) : sortBy === 'year' ? (b.indexedFromYear || 0) - (a.indexedFromYear || 0) : sortBy === 'articles' ? b.articleCount - a.articleCount : sortBy === 'citations' ? b.citationCount - a.citationCount : b.id - a.id);
  }, [query, sortBy, sources]);

  const submit = async (values: Values) => {
    setRequestError(''); setNotice('');
    const payload = { ...values, journalId: Number(values.journalId), publisherId: Number(values.publisherId), indexedFromYear: values.indexedFromYear ? Number(values.indexedFromYear) : '' };
    try {
      const response = editingId ? await api.put<{ message: string }>(`/admin/sources/${editingId}`, payload) : await api.post<{ message: string }>('/admin/sources', payload);
      setNotice(response.data.message); await load(); navigate('/admin/sources');
    } catch (error) { setRequestError((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unable to save the resource. Check that the journal ID is unique and valid.'); }
  };

  const remove = async (source: Source) => {
    if (!window.confirm(`Delete “${source.journalTitle}”?`)) return;
    setDeletingId(source.id); setRequestError('');
    try { const response = await api.delete<{ message: string }>(`/admin/sources/${source.id}`); setNotice(response.data.message); await load(); }
    catch (error) { setRequestError((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unable to delete the resource.'); }
    finally { setDeletingId(null); }
  };

  return <section><div className="manager-heading"><div><span className="eyebrow">Super Admin controls</span><h2>{mode === 'form' ? editingId ? 'Edit Resource' : 'Add New Resource' : 'Resource List'}</h2><p>Manage resource titles used by the journal index.</p></div>{mode === 'list' ? <button className="btn btn-primary" onClick={() => navigate('/admin/sources/addnew')}><i className="bi bi-plus-lg me-2"/>Add New</button> : <button className="btn btn-outline-secondary" onClick={() => navigate('/admin/sources')}><i className="bi bi-arrow-left me-2"/>Back to list</button>}</div>
    {mode === 'form' && <div className="admin-form-card"><div className="admin-panel-heading"><span className="form-icon"><i className="bi bi-journal-plus"/></span><div><h2>{editingId ? 'Edit Resource Record' : 'Create Resource Record'}</h2><p>Enter the resource, publisher, indexing, and contact information.</p></div></div><form onSubmit={handleSubmit(submit)} noValidate autoComplete="off"><div className="row g-3">
      <div className="col-md-4"><label>Journal ID</label><input className={`form-control ${errors.journalId ? 'is-invalid' : ''}`} autoComplete="off" data-lpignore="true" {...register('journalId')}/><div className="invalid-feedback">{errors.journalId?.message}</div></div>
      <div className="col-md-8"><label>Resource Title</label><input className={`form-control ${errors.journalTitle ? 'is-invalid' : ''}`} autoComplete="off" data-lpignore="true" {...register('journalTitle')}/><div className="invalid-feedback">{errors.journalTitle?.message}</div></div>
      <div className="col-md-4"><label>Abbreviation</label><input className="form-control" autoComplete="off" data-lpignore="true" placeholder="Example: IJM" {...register('abbreviation')}/></div>
      <div className="col-md-4"><label>Print ISSN</label><input className="form-control" autoComplete="off" data-lpignore="true" placeholder="Example: 0976-6502" {...register('printIssn')}/></div>
      <div className="col-md-4"><label>Online ISSN</label><input className="form-control" autoComplete="off" data-lpignore="true" placeholder="Example: 0976-6510" {...register('onlineIssn')}/></div>
      <div className="col-md-8"><label>Subject Area</label><input className="form-control" autoComplete="off" data-lpignore="true" placeholder="Example: Business and Management" {...register('subjectArea')}/></div>
      <div className="col-md-4"><label>Resource Type</label><select className={`form-select ${errors.sourceType ? 'is-invalid' : ''}`} {...register('sourceType')}><option value="Journal">Journal</option><option value="Conference Proceedings">Conference Proceedings</option><option value="Book Series">Book Series</option><option value="Book Chapter">Book Chapter</option><option value="Trade Journal">Trade Journal</option></select><div className="invalid-feedback">{errors.sourceType?.message}</div></div>
      <div className="col-md-6"><label>Resource Publisher</label><select className={`form-select ${errors.publisherId ? 'is-invalid' : ''}`} {...register('publisherId')}><option value="">Select resource publisher</option>{publishers.map(publisher=><option value={publisher.id} key={publisher.id}>{publisher.publisherName}</option>)}</select><div className="invalid-feedback">{errors.publisherId?.message}</div></div>
      <div className="col-md-3"><label>Indexed From Year</label><input className={`form-control ${errors.indexedFromYear ? 'is-invalid' : ''}`} inputMode="numeric" autoComplete="off" {...register('indexedFromYear')}/><div className="invalid-feedback">{errors.indexedFromYear?.message}</div></div>
      <div className="col-md-6"><label>Website</label><input className={`form-control ${errors.website ? 'is-invalid' : ''}`} autoComplete="off" data-lpignore="true" placeholder="https://example.com" {...register('website')}/><div className="invalid-feedback">{errors.website?.message}</div></div>
      <div className="col-md-6"><label>Email</label><input className="form-control" autoComplete="off" data-lpignore="true" {...register('email')}/></div>
      <div className="col-12">{requestError && <div className="alert alert-danger py-2">{requestError}</div>}<div className="d-flex justify-content-end gap-2"><button type="button" className="btn btn-outline-secondary" onClick={() => navigate('/admin/sources')}>Cancel</button><button className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editingId ? 'Update Resource' : 'Save Resource'} <i className="bi bi-check2 ms-2"/></button></div></div>
    </div></form></div>}
    {mode === 'list' && <div className="users-table-card"><div className="table-title admin-list-title"><h3>Resources</h3><AdminTableControls query={query} onQueryChange={setQuery} placeholder="Search title, abbreviation, ISSN, subject, type, publisher" sort={sortBy} onSortChange={setSortBy} options={[{value:'newest',label:'Newest first'},{value:'title',label:'Resource title A–Z'},{value:'publisher',label:'Resource Publisher A–Z'},{value:'year',label:'Indexed year: Newest'},{value:'articles',label:'Articles: High–Low'},{value:'citations',label:'Citations: High–Low'}]}/><span>{visibleSources.length} of {sources.length}</span></div>{requestError && <div className="alert alert-danger m-3">{requestError}</div>}{notice && <div className="alert alert-success m-3">{notice}</div>}<div className="table-responsive"><table className="table align-middle"><thead><tr><th>Sl. No.</th><th>Resource Title</th><th>ISSN</th><th>Subject Area</th><th>Resource Type</th><th>Resource Publisher</th><th>Indexed From</th><th>Articles</th><th>Citations</th><th>Actions</th></tr></thead><tbody>
      {loading && <tr><td colSpan={10} className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2"/>Loading resources…</td></tr>}
      {!loading && !visibleSources.length && <tr><td colSpan={10} className="text-center text-muted py-4">No resources found.</td></tr>}
      {!loading && pageSlice(visibleSources, page).map((source, index) => <tr key={source.id}><td>{(page - 1) * ADMIN_PAGE_SIZE + index + 1}</td><td><b>{source.journalTitle}</b><small>{source.abbreviation || 'No abbreviation'} · ID {source.journalId}</small>{source.website && <small><a href={source.website} target="_blank" rel="noreferrer">{source.website}</a></small>}</td><td><small>Print: {source.printIssn || '—'}</small><small>Online: {source.onlineIssn || '—'}</small></td><td>{source.subjectArea || '—'}</td><td><span className="badge text-bg-light">{source.sourceType || 'Journal'}</span></td><td>{source.publisher || '—'}</td><td>{source.indexedFromYear || '—'}</td><td>{source.articleCount.toLocaleString()}</td><td><span className="article-count-badge">{source.citationCount.toLocaleString()}</span></td><td><div className="d-flex gap-2"><button className="btn btn-sm btn-outline-primary" title="Edit" onClick={() => navigate(`/admin/sources/addnew?edit=${source.id}`)}><i className="bi bi-pencil"/></button><button className="btn btn-sm btn-outline-danger" title="Delete" onClick={() => remove(source)} disabled={deletingId === source.id}>{deletingId === source.id ? <span className="spinner-border spinner-border-sm"/> : <i className="bi bi-trash3"/>}</button></div></td></tr>)}
    </tbody></table></div><AdminPagination total={visibleSources.length} page={page} onPageChange={setPage}/></div>}
  </section>;
}
