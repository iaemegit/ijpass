import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../lib/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatCurrency } from '../lib/currency';
import AdminPagination, { ADMIN_PAGE_SIZE, pageSlice } from './AdminPagination';
import AdminTableControls from './AdminTableControls';

const schema = z.object({
  name: z.string().min(2, 'Enter the membership category'),
  eligibility: z.string().min(2, 'Enter the eligibility'),
  validity: z.string().min(2, 'Enter the validity'),
  usd: z.string().min(1, 'Enter the USD fee'),
  inr: z.string().min(1, 'Enter the INR fee')
});
type Values = z.infer<typeof schema>;
type Category = Values & { id: number; sortOrder: number; active: boolean };
const emptyValues: Values = { name: '', eligibility: '', validity: '', usd: '', inr: '' };

export default function MembershipCategoryManager({ mode = 'list' }: { mode?: 'list' | 'form' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [requestError, setRequestError] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('display-order');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: emptyValues });

  const load = useCallback(() => {
    setLoading(true);
    return api.get<{ categories: Category[] }>('/admin/membership-categories')
      .then(({ data }) => setCategories(data.categories))
      .catch(() => setRequestError('Unable to load membership categories.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (mode !== 'form') return;
    const editId = Number(new URLSearchParams(location.search).get('edit'));
    const category = categories.find(item => item.id === editId);
    if (category) {
      setEditingId(category.id);
      reset({ name: category.name, eligibility: category.eligibility, validity: category.validity, usd: category.usd, inr: category.inr });
    }
    else { setEditingId(null); reset(emptyValues); }
  }, [categories, location.search, mode, reset]);

  const submit = async (values: Values) => {
    setNotice(''); setRequestError('');
    try {
      const response = editingId
        ? await api.put<{ message: string }>(`/admin/membership-categories/${editingId}`, values)
        : await api.post<{ message: string }>('/admin/membership-categories', values);
      setNotice(response.data.message);
      setEditingId(null); reset(emptyValues); await load();
      navigate('/admin/membership-categories');
    } catch (error) {
      setRequestError((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unable to save the membership category.');
    }
  };
  const edit = (category: Category) => navigate(`/admin/membership-categories/addnew?edit=${category.id}`);
  const cancel = () => { setEditingId(null); reset(emptyValues); setRequestError(''); navigate('/admin/membership-categories'); };
  const remove = async (category: Category) => {
    if (!window.confirm(`Delete “${category.name}”? It will also disappear from the public membership categories page.`)) return;
    setDeletingId(category.id); setRequestError(''); setNotice('');
    try {
      await api.delete(`/admin/membership-categories/${category.id}`);
      setNotice('Membership category deleted successfully');
      if (editingId === category.id) cancel();
      await load();
    } catch { setRequestError('Unable to delete the membership category.'); }
    finally { setDeletingId(null); }
  };
  const visibleCategories = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const filtered = categories.filter(category => !search || [category.name, category.eligibility, category.validity, category.usd, category.inr].some(value => String(value || '').toLocaleLowerCase().includes(search)));
    const amount = (value: string) => Number(value.replace(/[^\d.]/g, '')) || Number.MAX_SAFE_INTEGER;
    return [...filtered].sort((first, second) => sortBy === 'name' ? first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }) : sortBy === 'validity' ? first.validity.localeCompare(second.validity, undefined, { sensitivity: 'base' }) : sortBy === 'usd' ? amount(first.usd) - amount(second.usd) : sortBy === 'inr' ? amount(first.inr) - amount(second.inr) : first.sortOrder - second.sortOrder);
  }, [categories, query, sortBy]);
  useEffect(() => setPage(1), [query, sortBy]);

  return <section className="membership-category-manager">
    <div className="manager-heading"><div><span className="eyebrow">Super Admin controls</span><h2>{mode === 'form' ? editingId ? 'Edit Membership Category' : 'Add Membership Category' : 'Membership Categories'}</h2><p>Manage the categories and fees displayed on the public membership page.</p></div><div className="d-flex gap-2">{mode === 'list' ? <><a className="btn btn-outline-secondary" href="/membership/categories" target="_blank" rel="noreferrer"><i className="bi bi-box-arrow-up-right me-2"/>View public page</a><button className="btn btn-primary" onClick={() => navigate('/admin/membership-categories/addnew')}><i className="bi bi-plus-lg me-2"/>Add New</button></> : <button className="btn btn-outline-secondary" onClick={() => navigate('/admin/membership-categories')}><i className="bi bi-arrow-left me-2"/>Back to list</button>}</div></div>
    {mode === 'form' && <div className="admin-form-card mb-4"><div className="admin-panel-heading"><span className="form-icon"><i className="bi bi-person-vcard"/></span><div><h2>{editingId ? 'Edit Membership Category' : 'Create Membership Category'}</h2><p>All five fields are required and are shown publicly exactly as entered.</p></div></div>
      <form onSubmit={handleSubmit(submit)} noValidate autoComplete="off"><div className="row g-3">
        <div className="col-md-6"><label>Membership Category</label><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.name ? 'is-invalid' : ''}`} {...register('name')}/><div className="invalid-feedback">{errors.name?.message}</div></div>
        <div className="col-md-6"><label>Validity</label><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.validity ? 'is-invalid' : ''}`} placeholder="Example: 1 Year" {...register('validity')}/><div className="invalid-feedback">{errors.validity?.message}</div></div>
        <div className="col-12"><label>Eligibility</label><textarea autoComplete="off" data-lpignore="true" rows={3} className={`form-control ${errors.eligibility ? 'is-invalid' : ''}`} {...register('eligibility')}/><div className="invalid-feedback">{errors.eligibility?.message}</div></div>
        <div className="col-md-6"><label>USD</label><div className="input-group"><span className="input-group-text">$</span><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.usd ? 'is-invalid' : ''}`} placeholder="Example: 50" {...register('usd')}/><div className="invalid-feedback">{errors.usd?.message}</div></div><small className="text-muted">Enter only the amount; the currency symbol is added automatically.</small></div>
        <div className="col-md-6"><label>INR</label><div className="input-group"><span className="input-group-text">₹</span><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.inr ? 'is-invalid' : ''}`} placeholder="Example: 4,000" {...register('inr')}/><div className="invalid-feedback">{errors.inr?.message}</div></div><small className="text-muted">Enter only the amount; the currency symbol is added automatically.</small></div>
        <div className="col-12">{requestError && <div className="alert alert-danger py-2">{requestError}</div>}{notice && <div className="alert alert-success py-2">{notice}</div>}<div className="d-flex justify-content-end gap-2">{editingId && <button type="button" className="btn btn-outline-secondary" onClick={cancel}>Cancel</button>}<button className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editingId ? 'Update Category' : 'Save Category'} <i className="bi bi-check2 ms-2"/></button></div></div>
      </div></form>
    </div>}
    {mode === 'list' && <div className="users-table-card"><div className="table-title admin-list-title"><h3>Membership Category List</h3><AdminTableControls query={query} onQueryChange={setQuery} placeholder="Search category, eligibility, validity, USD, INR" sort={sortBy} onSortChange={setSortBy} options={[{value:'display-order',label:'Display order'},{value:'name',label:'Category A–Z'},{value:'validity',label:'Validity A–Z'},{value:'usd',label:'USD: Low–High'},{value:'inr',label:'INR: Low–High'}]}/><span>{visibleCategories.length} of {categories.length}</span></div><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Sl. No.</th><th>Membership Category</th><th>Eligibility</th><th>Validity</th><th>USD</th><th>INR</th><th>Actions</th></tr></thead><tbody>
      {loading && <tr><td colSpan={7} className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2"/>Loading categories…</td></tr>}
      {!loading && !visibleCategories.length && <tr><td colSpan={7} className="text-center text-muted py-4">{query ? 'No membership categories match your search.' : 'No membership categories found.'}</td></tr>}
      {!loading && pageSlice(visibleCategories, page).map((category, index) => <tr key={category.id}><td>{(page - 1) * ADMIN_PAGE_SIZE + index + 1}</td><td><b>{category.name}</b></td><td>{category.eligibility}</td><td>{category.validity}</td><td>{formatCurrency(category.usd, '$')}</td><td>{formatCurrency(category.inr, '₹')}</td><td><div className="d-flex gap-2"><button className="btn btn-sm btn-outline-primary" title="Edit" onClick={() => edit(category)}><i className="bi bi-pencil"/></button><button className="btn btn-sm btn-outline-danger" title="Delete" onClick={() => remove(category)} disabled={deletingId === category.id}>{deletingId === category.id ? <span className="spinner-border spinner-border-sm"/> : <i className="bi bi-trash3"/>}</button></div></td></tr>)}
    </tbody></table></div><AdminPagination total={visibleCategories.length} page={page} onPageChange={setPage}/></div>}
  </section>;
}
