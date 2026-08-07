import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/auth';
import { countries } from '../data/countries';
import AdminPagination, { ADMIN_PAGE_SIZE, pageSlice } from './AdminPagination';
import AdminTableControls from './AdminTableControls';

const schema = z.object({
  publisherName: z.string().trim().min(2, 'Enter the publisher name').max(255),
  chiefEditor: z.string().trim().max(255),
  email: z.union([z.string().trim().email('Enter a valid email'), z.literal('')]),
  website: z
    .string()
    .trim()
    .refine(value => !value || /^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(value), 'Enter a valid website'),
  address: z.string().trim().max(2000),
  country: z.string().trim().max(100),
  active: z.boolean(),
});

type Values = z.infer<typeof schema>;
type Publisher = {
  id: number;
  publisherName: string;
  chiefEditor: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  country: string | null;
  active: boolean;
  sourceCount: number;
};

const emptyValues: Values = {
  publisherName: '',
  chiefEditor: '',
  email: '',
  website: '',
  address: '',
  country: '',
  active: true,
};

export default function JournalPublisherManager({ mode = 'list' }: { mode?: 'list' | 'form' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: emptyValues });

  const load = useCallback(
    () =>
      api
        .get<{ publishers: Publisher[] }>('/admin/journal-publishers')
        .then(({ data }) => setPublishers(data.publishers))
        .catch(() => setRequestError('Unable to load publishers.'))
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mode !== 'form') return;
    const id = Number(new URLSearchParams(location.search).get('edit'));
    const publisher = publishers.find(item => item.id === id);
    if (publisher) {
      setEditingId(id);
      reset({
        publisherName: publisher.publisherName,
        chiefEditor: publisher.chiefEditor || '',
        email: publisher.email || '',
        website: publisher.website || '',
        address: publisher.address || '',
        country: publisher.country || '',
        active: publisher.active,
      });
    } else {
      setEditingId(null);
      reset(emptyValues);
    }
  }, [location.search, mode, publishers, reset]);

  useEffect(() => setPage(1), [query, sortBy]);

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    const filtered = publishers.filter(publisher =>
      !search ||
      [
        publisher.publisherName,
        publisher.chiefEditor,
        publisher.email,
        publisher.website,
        publisher.address,
        publisher.country,
        publisher.active ? 'enabled' : 'disabled',
      ].some(value => String(value || '').toLowerCase().includes(search))
    );
    return [...filtered].sort((a, b) =>
      sortBy === 'sources'
        ? b.sourceCount - a.sourceCount
        : sortBy === 'country'
          ? (a.country || '').localeCompare(b.country || '')
          : a.publisherName.localeCompare(b.publisherName),
    );
  }, [publishers, query, sortBy]);

  const submit = async (values: Values) => {
    setRequestError('');
    try {
      const payload = {
        ...values,
        website: values.website ? `https://${values.website.replace(/^https?:\/\//i, '')}` : '',
      };
      const response = editingId
        ? await api.put<{ message: string }>(`/admin/journal-publishers/${editingId}`, payload)
        : await api.post<{ message: string }>('/admin/journal-publishers', payload);
      setNotice(response.data.message);
      await load();
      navigate('/admin/journal-publishers');
    } catch (error) {
      setRequestError(
        (error as { response?: { data?: { message?: string } } }).response?.data?.message ||
          'Unable to save the publisher.',
      );
    }
  };

  const remove = async (publisher: Publisher) => {
    if (!window.confirm(`Delete “${publisher.publisherName}”?`)) return;
    setDeletingId(publisher.id);
    setRequestError('');
    try {
      const response = await api.delete<{ message: string }>(`/admin/journal-publishers/${publisher.id}`);
      setNotice(response.data.message);
      await load();
    } catch (error) {
      setRequestError(
        (error as { response?: { data?: { message?: string } } }).response?.data?.message ||
          'Unable to delete the publisher.',
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section>
      <div className="manager-heading">
        <div>
          <span className="eyebrow">Super Admin controls</span>
          <h2>{mode === 'form' ? (editingId ? 'Edit Source Publisher' : 'Add New Source Publisher') : 'Source Publishers'}</h2>
          <p>Manage publishers for journals, conferences, books, book series, and book chapters.</p>
        </div>
        {mode === 'list' ? (
          <button className="btn btn-primary" onClick={() => navigate('/admin/journal-publishers/addnew')}>
            <i className="bi bi-plus-lg me-2" />
            Add New
          </button>
        ) : (
          <button className="btn btn-outline-secondary" onClick={() => navigate('/admin/journal-publishers')}>
            <i className="bi bi-arrow-left me-2" />
            Back to list
          </button>
        )}
      </div>

      {mode === 'form' && (
        <div className="admin-form-card">
          <div className="admin-panel-heading">
            <span className="form-icon">
              <i className="bi bi-buildings" />
            </span>
            <div>
              <h2>{editingId ? 'Edit Source Publisher Record' : 'Create Source Publisher Record'}</h2>
              <p>Enter the source publisher and chief editor contact information.</p>
            </div>
          </div>
          <form onSubmit={handleSubmit(submit)} noValidate autoComplete="off">
            <div className="row g-3">
              <div className="col-md-6">
                <label>Source Publisher Name</label>
                <input className={`form-control ${errors.publisherName ? 'is-invalid' : ''}`} {...register('publisherName')} />
                <div className="invalid-feedback">{errors.publisherName?.message}</div>
              </div>
              <div className="col-md-6">
                <label>Chief Editor</label>
                <input className="form-control" {...register('chiefEditor')} />
              </div>
              <div className="col-md-6">
                <label>Email</label>
                <input type="email" className={`form-control ${errors.email ? 'is-invalid' : ''}`} {...register('email')} />
                <div className="invalid-feedback">{errors.email?.message}</div>
              </div>
              <div className="col-md-6">
                <label>Website</label>
                <input className={`form-control ${errors.website ? 'is-invalid' : ''}`} placeholder="https://example.com" {...register('website')} />
                <div className="invalid-feedback">{errors.website?.message}</div>
              </div>
              <div className="col-md-8">
                <label>Address</label>
                <textarea className="form-control" rows={3} {...register('address')} />
              </div>
              <div className="col-md-4">
                <label>Country</label>
                <select className="form-select" {...register('country')}>
                  <option value="">Select country</option>
                  {countries.map(country => <option key={country}>{country}</option>)}
                </select>
              </div>
              <div className="col-md-4">
                <label>Status</label>
                <select className="form-select" {...register('active', { setValueAs: value => value === true || value === 'true' })}>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
                <small className="text-muted d-block mt-1">Disabled publishers remain in admin only.</small>
              </div>
              <div className="col-12">
                {requestError && <div className="alert alert-danger py-2">{requestError}</div>}
                <div className="d-flex justify-content-end gap-2">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => navigate('/admin/journal-publishers')}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? 'Saving…' : editingId ? 'Update Publisher' : 'Save Publisher'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {mode === 'list' && (
        <div className="users-table-card">
          <div className="table-title admin-list-title">
            <h3>Source Publisher List</h3>
            <AdminTableControls
              query={query}
              onQueryChange={setQuery}
              placeholder="Search source publisher, editor, email, website, address, country, status"
              sort={sortBy}
              onSortChange={setSortBy}
              options={[
                { value: 'name', label: 'Source Publisher A–Z' },
                { value: 'country', label: 'Country A–Z' },
                { value: 'sources', label: 'Sources: High–Low' },
              ]}
            />
            <span>{visible.length} of {publishers.length}</span>
          </div>
          {requestError && <div className="alert alert-danger m-3">{requestError}</div>}
          {notice && <div className="alert alert-success m-3">{notice}</div>}
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Sl. No.</th>
                  <th>Source Publisher</th>
                  <th>Chief Editor</th>
                  <th>Email</th>
                  <th>Website</th>
                  <th>Address / Country</th>
                  <th>Status</th>
                  <th>Sources</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="text-center py-4">Loading source publishers…</td>
                  </tr>
                ) : pageSlice(visible, page).map((publisher, index) => (
                  <tr key={publisher.id}>
                    <td>{(page - 1) * ADMIN_PAGE_SIZE + index + 1}</td>
                    <td><b>{publisher.publisherName}</b></td>
                    <td>{publisher.chiefEditor || '—'}</td>
                    <td>{publisher.email || '—'}</td>
                    <td>{publisher.website ? <a href={publisher.website} target="_blank" rel="noreferrer">Visit website</a> : '—'}</td>
                    <td>{publisher.address || '—'}<small>{publisher.country || '—'}</small></td>
                    <td><span className={`user-status ${publisher.active ? 'active' : ''}`}>{publisher.active ? 'Enabled' : 'Disabled'}</span></td>
                    <td>{publisher.sourceCount.toLocaleString()}</td>
                    <td>
                      <div className="d-flex gap-2">
                        <button className="btn btn-sm btn-outline-primary" onClick={() => navigate(`/admin/journal-publishers/addnew?edit=${publisher.id}`)}>
                          <i className="bi bi-pencil" />
                        </button>
                        <button className="btn btn-sm btn-outline-danger" disabled={deletingId === publisher.id} onClick={() => remove(publisher)}>
                          <i className="bi bi-trash3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && !visible.length && (
                  <tr>
                    <td colSpan={9} className="text-center text-muted py-4">No source publishers found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <AdminPagination total={visible.length} page={page} onPageChange={setPage} />
        </div>
      )}
    </section>
  );
}
