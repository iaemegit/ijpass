import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/auth';
import AdminPagination, { pageSlice } from './AdminPagination';
import AdminTableControls from './AdminTableControls';

const schema = z.object({
  name: z.string().min(2, 'Enter the user’s full name'),
  email: z.string().email('Enter a valid email'),
  organization: z.string().optional(),
  password: z.string().refine(value => !value || value.length >= 12, 'Use at least 12 characters'),
  active: z.boolean()
});
type Values = z.infer<typeof schema>;
type InternalUser = { id: number; name: string; email: string; organization?: string | null; active: boolean; createdAt: string; lastLoginAt?: string | null };
const emptyValues: Values = { name: '', email: '', organization: 'IJPAss', password: '', active: true };

const makePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!_-';
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(bytes, value => chars[value % chars.length]).join('');
};

export default function InternalUserManager({ mode = 'list' }: { mode?: 'list' | 'form' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [users, setUsers] = useState<InternalUser[]>([]);
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
  const loadUsers = useCallback(() => api.get<{ users: InternalUser[] }>('/admin/internal-users').then(({ data }) => setUsers(data.users)).catch(() => setRequestError('Unable to load internal users.')), []);
  useEffect(() => { void loadUsers(); }, [loadUsers]);
  useEffect(() => {
    if (mode !== 'form') return;
    const editId = Number(new URLSearchParams(location.search).get('edit'));
    const user = users.find(item => item.id === editId);
    if (user) { setEditingId(user.id); setShowPassword(false); reset({ name: user.name, email: user.email, organization: user.organization || '', password: '', active: user.active }); }
    else { setEditingId(null); setShowPassword(false); reset(emptyValues); }
  }, [location.search, mode, reset, users]);

  const submit = async (values: Values) => {
    setRequestError(''); setNotice('');
    if (!editingId && values.password.length < 12) { setRequestError('A temporary password of at least 12 characters is required.'); return; }
    try {
      const payload = { ...values, password: values.password || undefined };
      const response = editingId
        ? await api.put<{ message: string }>(`/admin/internal-users/${editingId}`, payload)
        : await api.post<{ message: string }>('/admin/internal-users', payload);
      setNotice(response.data.message); reset(emptyValues); navigate('/admin/internal-users');
    } catch (error) { setRequestError((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unable to save the Internal User.'); }
  };
  const generate = () => setValue('password', makePassword(), { shouldValidate: true });
  const copy = async () => { if (password) { await navigator.clipboard.writeText(password); setNotice('Password copied. Share it securely.'); } };
  const edit = (user: InternalUser) => navigate(`/admin/internal-users/addnew?edit=${user.id}`);
  const remove = async (user: InternalUser) => {
    if (!window.confirm(`Delete Internal User “${user.name}”? This cannot be undone.`)) return;
    setDeletingId(user.id); setRequestError('');
    try { await api.delete(`/admin/internal-users/${user.id}`); await loadUsers(); }
    catch (error) { setRequestError((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unable to delete the Internal User.'); }
    finally { setDeletingId(null); }
  };
  const visibleUsers = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const filtered = users.filter(user => !search || [`IU-${String(user.id).padStart(5, '0')}`, user.name, user.email, user.organization, user.active ? 'enabled' : 'disabled'].some(value => String(value || '').toLocaleLowerCase().includes(search)));
    const compare = (first?: string | null, second?: string | null) => (first || '').localeCompare(second || '', undefined, { sensitivity: 'base' });
    return [...filtered].sort((first, second) => sortBy === 'oldest' ? first.id - second.id : sortBy === 'name' ? compare(first.name, second.name) : sortBy === 'email' ? compare(first.email, second.email) : sortBy === 'organization' ? compare(first.organization, second.organization) : sortBy === 'status' ? Number(second.active) - Number(first.active) || compare(first.name, second.name) : second.id - first.id);
  }, [query, sortBy, users]);
  useEffect(() => setPage(1), [query, sortBy]);

  return <section className="user-manager">
    <div className="manager-heading"><div><span className="eyebrow">Super Admin controls</span><h2>{mode === 'form' ? editingId ? 'Edit Internal User' : 'Create Internal User' : 'Internal User Management'}</h2><p>Manage limited-access accounts for authorized data-entry staff.</p></div>{mode === 'list' ? <button className="btn btn-primary" onClick={() => navigate('/admin/internal-users/addnew')}><i className="bi bi-plus-lg me-2"/>Add New</button> : <button className="btn btn-outline-secondary" onClick={() => navigate('/admin/internal-users')}><i className="bi bi-arrow-left me-2"/>Back to list</button>}</div>
    {mode === 'form' && <div className="manager-layout"><form className="internal-user-form" onSubmit={handleSubmit(submit)} noValidate autoComplete="off"><h3>{editingId ? 'Edit Internal User' : 'Create Internal User'}</h3><div className="row g-3">
      <div className="col-md-6"><label>Full name</label><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.name ? 'is-invalid' : ''}`} {...register('name')}/><div className="invalid-feedback">{errors.name?.message}</div></div>
      <div className="col-md-6"><label>Email / Login ID</label><input type="email" autoComplete="off" data-lpignore="true" className={`form-control ${errors.email ? 'is-invalid' : ''}`} {...register('email')}/><div className="invalid-feedback">{errors.email?.message}</div></div>
      <div className="col-md-6"><label>Organization / Department</label><input autoComplete="off" data-lpignore="true" className="form-control" {...register('organization')}/></div>
      <div className="col-md-6"><label>Account Status</label><select className="form-select" {...register('active', { setValueAs: value => value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></div>
      <div className="col-12"><label>{editingId ? 'New password (optional)' : 'Temporary password'}</label><div className="password-create"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" data-lpignore="true" className={`form-control ${errors.password ? 'is-invalid' : ''}`} {...register('password')}/><button type="button" onClick={() => setShowPassword(value => !value)} title={showPassword ? 'Hide password' : 'Show password'} aria-label={showPassword ? 'Hide password' : 'Show password'}><i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`}/></button><button type="button" onClick={copy} disabled={!password} title="Copy password" aria-label="Copy password"><i className="bi bi-copy"/></button><button type="button" onClick={generate}>Generate</button></div>{errors.password && <div className="field-error">{errors.password.message}</div>}<small>{editingId ? 'Leave blank to keep the existing password. Enter or generate a new password to reset it.' : 'Minimum 12 characters.'}</small></div>
      <div className="col-12">{requestError && <div className="alert alert-danger py-2">{requestError}</div>}{notice && <div className="alert alert-success py-2">{notice}</div>}<button className="btn btn-primary w-100" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editingId ? 'Update Internal User' : 'Create Internal User'}<i className="bi bi-person-check ms-2"/></button></div>
    </div></form><div className="credential-note"><i className="bi bi-key"/><h3>Credential security</h3><p>Passwords are stored only as bcrypt hashes. Disabled accounts cannot sign in.</p><ul><li>Leave the password blank while editing to keep it unchanged.</li><li>Send new credentials through a secure channel.</li><li>Use a unique password for every user.</li></ul></div></div>}
    {mode === 'list' && <div className="users-table-card"><div className="table-title admin-list-title"><h3>Internal Users</h3><AdminTableControls query={query} onQueryChange={setQuery} placeholder="Search ID, name, email, organization, status" sort={sortBy} onSortChange={setSortBy} options={[{value:'newest',label:'Newest first'},{value:'oldest',label:'Oldest first'},{value:'name',label:'Name A–Z'},{value:'email',label:'Email A–Z'},{value:'organization',label:'Organization A–Z'},{value:'status',label:'Status'}]}/><span>{visibleUsers.length} of {users.length}</span></div>{requestError && <div className="alert alert-danger m-3">{requestError}</div>}<div className="table-responsive"><table className="table align-middle"><thead><tr><th>Database ID</th><th>User</th><th>Organization</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>{visibleUsers.length ? pageSlice(visibleUsers, page).map(user => <tr key={user.id}><td><code>IU-{String(user.id).padStart(5,'0')}</code></td><td><b>{user.name}</b><small>{user.email}</small></td><td>{user.organization || '—'}</td><td><span className={`user-status ${user.active ? 'active' : ''}`}>{user.active ? 'Enabled' : 'Disabled'}</span></td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td><div className="d-flex gap-2"><button className="btn btn-sm btn-outline-primary" title="Edit" onClick={() => edit(user)}><i className="bi bi-pencil"/></button><button className="btn btn-sm btn-outline-danger" title="Delete" onClick={() => remove(user)} disabled={deletingId === user.id}>{deletingId === user.id ? <span className="spinner-border spinner-border-sm"/> : <i className="bi bi-trash3"/>}</button></div></td></tr>) : <tr><td colSpan={6} className="text-center text-muted py-4">{query ? 'No Internal Users match your search.' : 'No Internal Users have been created.'}</td></tr>}</tbody></table></div><AdminPagination total={visibleUsers.length} page={page} onPageChange={setPage}/></div>}
  </section>;
}
