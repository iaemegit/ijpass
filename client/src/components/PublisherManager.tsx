import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/auth';
import { countries } from '../data/countries';
import AdminPagination, { pageSlice } from './AdminPagination';
import AdminTableControls from './AdminTableControls';

const normalizeWebsite = (value: string) => value.trim() ? `https://${value.trim().replace(/^https?:\/\//i, '')}` : '';

const schema = z.object({
  organization: z.string().min(2, 'Enter the organization name'),
  name: z.string().min(2, 'Enter the primary contact name'),
  email: z.string().email('Enter a valid login email'),
  country: z.string().optional(),
  website: z.string().refine(value => { if (!value.trim()) return true; try { new URL(normalizeWebsite(value)); return true; } catch { return false; } }, 'Enter a valid website address'),
  password: z.string().refine(value => !value || value.length >= 12, 'Use at least 12 characters'),
  active: z.boolean()
});
type Values = z.infer<typeof schema>;
type Publisher = Omit<Values, 'password'> & { id: number; createdAt: string; lastLoginAt?: string | null };
const emptyValues: Values = { organization: '', name: '', email: '', country: '', website: '', password: '', active: true };

const makePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!_-';
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(bytes, value => chars[value % chars.length]).join('');
};

export default function PublisherManager({ mode = 'list' }: { mode?: 'list' | 'form' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [requestError, setRequestError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: emptyValues });
  const password = watch('password');
  const load = useCallback(() => api.get<{ publishers: Publisher[] }>('/admin/publishers').then(({ data }) => setPublishers(data.publishers)).catch(() => setRequestError('Unable to load publisher accounts.')), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (mode !== 'form') return;
    const editId = Number(new URLSearchParams(location.search).get('edit'));
    const publisher = publishers.find(item => item.id === editId);
    if (publisher) { setEditingId(publisher.id); setShowPassword(false); reset({ organization: publisher.organization || '', name: publisher.name, email: publisher.email, country: publisher.country || '', website: (publisher.website || '').replace(/^https?:\/\//i, ''), password: '', active: publisher.active }); }
    else { setEditingId(null); setShowPassword(false); reset(emptyValues); }
  }, [location.search, mode, publishers, reset]);

  const submit = async (values: Values) => {
    setRequestError(''); setNotice('');
    if (!editingId && values.password.length < 12) { setRequestError('A temporary password of at least 12 characters is required.'); return; }
    try {
      const payload = { ...values, website: normalizeWebsite(values.website), password: values.password || undefined };
      const response = editingId
        ? await api.put<{ message: string }>(`/admin/publishers/${editingId}`, payload)
        : await api.post<{ message: string }>('/admin/publishers', payload);
      setNotice(response.data.message); reset(emptyValues); navigate('/admin/publishers');
    } catch (error) { setRequestError((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unable to save the publisher account.'); }
  };
  const generate = () => setValue('password', makePassword(), { shouldValidate: true });
  const copy = async () => { if (password) { await navigator.clipboard.writeText(password); setNotice('Password copied. Share it securely.'); } };
  const remove = async (publisher: Publisher) => {
    if (!window.confirm(`Delete publisher account “${publisher.organization}”? This cannot be undone.`)) return;
    setDeletingId(publisher.id); setRequestError('');
    try { await api.delete(`/admin/publishers/${publisher.id}`); await load(); }
    catch (error) { setRequestError((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unable to delete the publisher account.'); }
    finally { setDeletingId(null); }
  };
  const visiblePublishers = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const filtered = publishers.filter(publisher => !search || [`PU-${String(publisher.id).padStart(5, '0')}`, publisher.organization, publisher.name, publisher.email, publisher.country, publisher.website, publisher.active ? 'enabled' : 'disabled'].some(value => String(value || '').toLocaleLowerCase().includes(search)));
    const compare = (first?: string | null, second?: string | null) => (first || '').localeCompare(second || '', undefined, { sensitivity: 'base' });
    return [...filtered].sort((first, second) => sortBy === 'oldest' ? first.id - second.id : sortBy === 'organization' ? compare(first.organization, second.organization) : sortBy === 'contact' ? compare(first.name, second.name) : sortBy === 'email' ? compare(first.email, second.email) : sortBy === 'country' ? compare(first.country, second.country) : sortBy === 'status' ? Number(second.active) - Number(first.active) || compare(first.organization, second.organization) : second.id - first.id);
  }, [publishers, query, sortBy]);
  useEffect(() => setPage(1), [query, sortBy]);

  return <section className="user-manager">
    <div className="manager-heading"><div><span className="eyebrow">Super Admin controls</span><h2>{mode === 'form' ? editingId ? 'Edit Publisher Account' : 'Create Publisher Account' : 'Publisher Accounts'}</h2><p>Manage publishing organizations and their portal access.</p></div>{mode === 'list' ? <button className="btn btn-primary" onClick={() => navigate('/admin/publishers/addnew')}><i className="bi bi-plus-lg me-2"/>Add New</button> : <button className="btn btn-outline-secondary" onClick={() => navigate('/admin/publishers')}><i className="bi bi-arrow-left me-2"/>Back to list</button>}</div>
    {mode === 'form' && <div className="admin-form-card"><form onSubmit={handleSubmit(submit)} noValidate autoComplete="off"><div className="row g-3">
      <div className="col-md-6"><label>Organization name</label><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.organization ? 'is-invalid' : ''}`} {...register('organization')}/><div className="invalid-feedback">{errors.organization?.message}</div></div>
      <div className="col-md-6"><label>Primary contact name</label><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.name ? 'is-invalid' : ''}`} {...register('name')}/><div className="invalid-feedback">{errors.name?.message}</div></div>
      <div className="col-md-6"><label>Login email</label><input type="email" autoComplete="off" data-lpignore="true" className={`form-control ${errors.email ? 'is-invalid' : ''}`} {...register('email')}/><div className="invalid-feedback">{errors.email?.message}</div></div>
      <div className="col-md-6"><label>Country</label><select className="form-select" {...register('country')}><option value="">Select country</option>{countries.map(country => <option value={country} key={country}>{country}</option>)}</select></div>
      <div className="col-md-6"><label>Website</label><div className="input-group"><span className="input-group-text">https://</span><input type="text" autoComplete="off" data-lpignore="true" className={`form-control ${errors.website ? 'is-invalid' : ''}`} placeholder="www.example.com" {...register('website')}/><div className="invalid-feedback">{errors.website?.message}</div></div><small className="text-muted">You may enter the address with or without www, http://, or https://.</small></div>
      <div className="col-md-6"><label>Account Status</label><select className="form-select" {...register('active', { setValueAs: value => value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></div>
      <div className="col-12"><label>{editingId ? 'New password (optional)' : 'Temporary password'}</label><div className="password-create"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" data-lpignore="true" className={`form-control ${errors.password ? 'is-invalid' : ''}`} {...register('password')}/><button type="button" onClick={() => setShowPassword(value => !value)} title={showPassword ? 'Hide password' : 'Show password'} aria-label={showPassword ? 'Hide password' : 'Show password'}><i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`}/></button><button type="button" onClick={copy} disabled={!password} title="Copy password" aria-label="Copy password"><i className="bi bi-copy"/></button><button type="button" onClick={generate}>Generate</button></div>{errors.password && <div className="field-error">{errors.password.message}</div>}<small>{editingId ? 'Leave blank to keep the existing password. Enter or generate a new password to reset it.' : 'Minimum 12 characters.'}</small></div>
      <div className="col-12">{requestError && <div className="alert alert-danger py-2">{requestError}</div>}{notice && <div className="alert alert-success py-2">{notice}</div>}<div className="d-flex justify-content-end"><button className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editingId ? 'Update Publisher' : 'Create Publisher'} <i className="bi bi-building-check ms-2"/></button></div></div>
    </div></form></div>}
    {mode === 'list' && <div className="users-table-card"><div className="table-title admin-list-title"><h3>Publisher Account List</h3><AdminTableControls query={query} onQueryChange={setQuery} placeholder="Search ID, organization, contact, email, country, website, status" sort={sortBy} onSortChange={setSortBy} options={[{value:'newest',label:'Newest first'},{value:'oldest',label:'Oldest first'},{value:'organization',label:'Organization A–Z'},{value:'contact',label:'Contact A–Z'},{value:'email',label:'Email A–Z'},{value:'country',label:'Country A–Z'},{value:'status',label:'Status'}]}/><span>{visiblePublishers.length} of {publishers.length}</span></div>{requestError && <div className="alert alert-danger m-3">{requestError}</div>}<div className="table-responsive"><table className="table align-middle"><thead><tr><th>Database ID</th><th>Organization</th><th>Primary Contact</th><th>Email</th><th>Country</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visiblePublishers.length ? pageSlice(visiblePublishers, page).map(publisher => <tr key={publisher.id}><td><code>PU-{String(publisher.id).padStart(5, '0')}</code></td><td><b>{publisher.organization}</b>{publisher.website && <small><a href={publisher.website} target="_blank" rel="noreferrer">{publisher.website}</a></small>}</td><td>{publisher.name}</td><td>{publisher.email}</td><td>{publisher.country || '—'}</td><td><span className={`user-status ${publisher.active ? 'active' : ''}`}>{publisher.active ? 'Enabled' : 'Disabled'}</span></td><td><div className="d-flex gap-2"><button className="btn btn-sm btn-outline-primary" title="Edit" onClick={() => navigate(`/admin/publishers/addnew?edit=${publisher.id}`)}><i className="bi bi-pencil"/></button><button className="btn btn-sm btn-outline-danger" title="Delete" onClick={() => remove(publisher)} disabled={deletingId === publisher.id}>{deletingId === publisher.id ? <span className="spinner-border spinner-border-sm"/> : <i className="bi bi-trash3"/>}</button></div></td></tr>) : <tr><td colSpan={7} className="text-center text-muted py-4">{query ? 'No Publisher Accounts match your search.' : 'No Publisher Accounts have been created.'}</td></tr>}</tbody></table></div><AdminPagination total={visiblePublishers.length} page={page} onPageChange={setPage}/></div>}
  </section>;
}
