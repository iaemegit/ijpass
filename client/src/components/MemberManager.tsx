import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/auth';
import { countries } from '../data/countries';
import AdminPagination, { pageSlice } from './AdminPagination';

const optionalProfileUrl = z.string().refine(value => !value.trim() || /^https?:\/\/.+/i.test(value) || /^[\w.-]+\.[a-z]{2,}/i.test(value), 'Enter a valid profile link');
const schema = z.object({
  membershipCategoryId: z.string().min(1, 'Select a membership category'),
  membershipFrom: z.string().min(1, 'Select the membership start date'),
  fullName: z.string().min(2, 'Enter the member’s full name'),
  email: z.string().email('Enter a valid member email address'),
  affiliation: z.string().optional(),
  country: z.string().optional(),
  shortProfile: z.string().max(1500, 'Use 1,500 characters or fewer').optional(),
  fieldOfExpertise: z.string().optional(),
  researchPapersPublished: z.coerce.number().int().min(0, 'Enter zero or a positive number'),
  googleScholarUrl: optionalProfileUrl,
  researchGateUrl: optionalProfileUrl,
  orcid: optionalProfileUrl,
  active: z.enum(['true', 'false']),
  photo: z.any().optional()
});
type Values = z.infer<typeof schema>;
type Category = { id: number; name: string };
type Member = {
  id: number;
  membershipId?: string | null;
  membershipFrom?: string | null;
  membershipUntil?: string | null;
  fullName: string;
  email?: string | null;
  affiliation?: string | null;
  country?: string | null;
  photo?: string | null;
  shortProfile?: string | null;
  fieldOfExpertise?: string | null;
  researchPapersPublished: number;
  googleScholarUrl?: string | null;
  researchGateUrl?: string | null;
  orcid?: string | null;
  active: boolean;
  membershipCategory: Category;
};
const emptyValues: Values = { membershipCategoryId: '', membershipFrom: new Date().toISOString().slice(0, 10), fullName: '', email: '', affiliation: '', country: '', shortProfile: '', fieldOfExpertise: '', researchPapersPublished: 0, googleScholarUrl: '', researchGateUrl: '', orcid: '', active: 'true' };
const normalizeUrl = (value: string) => value.trim() ? `https://${value.trim().replace(/^https?:\/\//i, '')}` : '';

export default function MemberManager({ mode = 'list' }: { mode?: 'list' | 'form' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [requestError, setRequestError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSort, setMemberSort] = useState('name-asc');
  const [memberPage, setMemberPage] = useState(1);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: emptyValues });

  const load = useCallback(async () => {
    setRequestError('');
    try {
      const [categoryResponse, memberResponse] = await Promise.all([
        api.get<{ categories: Category[] }>('/admin/membership-categories'),
        api.get<{ members: Member[] }>('/admin/members')
      ]);
      setCategories(categoryResponse.data.categories);
      setMembers(memberResponse.data.members);
    } catch { setRequestError('Unable to load member records.'); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (mode !== 'form') return;
    const editId = Number(new URLSearchParams(location.search).get('edit'));
    const member = members.find(item => item.id === editId);
    if (member) {
      setEditingId(member.id);
      reset({
        membershipCategoryId: String(member.membershipCategory.id),
        membershipFrom: member.membershipFrom ? member.membershipFrom.slice(0, 10) : new Date().toISOString().slice(0, 10),
        fullName: member.fullName,
        email: member.email || '',
        affiliation: member.affiliation || '',
        country: member.country || '',
        shortProfile: member.shortProfile || '',
        fieldOfExpertise: member.fieldOfExpertise || '',
        researchPapersPublished: member.researchPapersPublished,
        googleScholarUrl: member.googleScholarUrl || '',
        researchGateUrl: member.researchGateUrl || '',
        orcid: member.orcid || '',
        active: member.active ? 'true' : 'false'
      });
    } else {
      setEditingId(null);
      reset(emptyValues);
    }
  }, [location.search, members, mode, reset]);

  const makeFormData = (values: Values) => {
    const formData = new FormData();
    formData.append('membershipCategoryId', values.membershipCategoryId);
    formData.append('membershipFrom', values.membershipFrom);
    formData.append('fullName', values.fullName);
    formData.append('email', values.email);
    formData.append('affiliation', values.affiliation || '');
    formData.append('country', values.country || '');
    formData.append('shortProfile', values.shortProfile || '');
    formData.append('fieldOfExpertise', values.fieldOfExpertise || '');
    formData.append('researchPapersPublished', String(values.researchPapersPublished));
    formData.append('googleScholarUrl', normalizeUrl(values.googleScholarUrl));
    formData.append('researchGateUrl', normalizeUrl(values.researchGateUrl));
    formData.append('orcid', normalizeUrl(values.orcid));
    formData.append('active', values.active);
    const photo = values.photo instanceof FileList ? values.photo.item(0) : undefined;
    if (photo) formData.append('photo', photo);
    return formData;
  };

  const submit = async (values: Values) => {
    setRequestError('');
    setNotice('');
    try {
      const response = editingId
        ? await api.put<{ message: string }>(`/admin/members/${editingId}`, makeFormData(values))
        : await api.post<{ message: string }>('/admin/members', makeFormData(values));
      setNotice(response.data.message);
      await load();
      reset(emptyValues);
      navigate('/admin/members');
    } catch (error) { setRequestError((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unable to save the member.'); }
  };

  const edit = (member: Member) => navigate(`/admin/members/addnew?edit=${member.id}`);
  const remove = async (member: Member) => {
    if (!window.confirm(`Delete member “${member.fullName}”? This cannot be undone.`)) return;
    setDeletingId(member.id);
    setRequestError('');
    try { await api.delete(`/admin/members/${member.id}`); await load(); }
    catch (error) { setRequestError((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unable to delete the member.'); }
    finally { setDeletingId(null); }
  };
  const editingMember = members.find(member => member.id === editingId);
  const visibleMembers = useMemo(() => {
    const search = memberSearch.trim().toLocaleLowerCase();
    const filtered = members.filter(member => {
      const expired = Boolean(member.membershipUntil && new Date(member.membershipUntil) <= new Date());
      const status = member.active ? 'enabled' : expired ? 'expired' : 'disabled';
      return !search || [member.membershipCategory.name, member.fullName, member.country, member.affiliation, member.membershipId, member.email, status]
        .some(value => String(value || '').toLocaleLowerCase().includes(search));
    });
    return [...filtered].sort((first, second) => {
      const compareText = (firstValue?: string | null, secondValue?: string | null) => (firstValue || '').localeCompare(secondValue || '', undefined, { sensitivity: 'base' });
      if (memberSort === 'name-desc') return -first.fullName.localeCompare(second.fullName, undefined, { sensitivity: 'base' });
      if (memberSort === 'category') return first.membershipCategory.name.localeCompare(second.membershipCategory.name, undefined, { sensitivity: 'base' }) || first.fullName.localeCompare(second.fullName);
      if (memberSort === 'country') return (first.country || '').localeCompare(second.country || '', undefined, { sensitivity: 'base' }) || first.fullName.localeCompare(second.fullName);
      if (memberSort === 'member-id') return compareText(first.membershipId, second.membershipId);
      if (memberSort === 'status') {
        const statusRank = (member: Member) => member.active ? 0 : member.membershipUntil && new Date(member.membershipUntil) <= new Date() ? 1 : 2;
        return statusRank(first) - statusRank(second) || first.fullName.localeCompare(second.fullName);
      }
      return first.fullName.localeCompare(second.fullName, undefined, { sensitivity: 'base' });
    });
  }, [memberSearch, memberSort, members]);
  useEffect(() => setMemberPage(1), [memberSearch, memberSort]);
  const pagedMembers = pageSlice(visibleMembers, memberPage);

  return <section className="member-manager">
    <div className="manager-heading"><div><span className="eyebrow">Super Admin controls</span><h2>{mode === 'form' ? editingId ? 'Edit Member' : 'Add Member' : 'Members List'}</h2><p>Manage public member directory records and professional profiles.</p></div>{mode === 'list' ? <button className="btn btn-primary" onClick={() => navigate('/admin/members/addnew')}><i className="bi bi-plus-lg me-2"/>Add New</button> : <button className="btn btn-outline-secondary" onClick={() => navigate('/admin/members')}><i className="bi bi-arrow-left me-2"/>Back to list</button>}</div>
    {mode === 'form' && <div className="admin-form-card"><form onSubmit={handleSubmit(submit)} noValidate autoComplete="off" encType="multipart/form-data"><div className="row g-3">
      <div className="col-md-6"><label>Membership Category</label><select className={`form-select ${errors.membershipCategoryId ? 'is-invalid' : ''}`} {...register('membershipCategoryId')}><option value="">Select category</option>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select><div className="invalid-feedback">{errors.membershipCategoryId?.message}</div></div>
      <div className="col-md-6"><label>Membership ID</label><div className="input-group"><span className="input-group-text"><i className="bi bi-person-badge"/></span><input className="form-control" value={editingMember?.membershipId || 'Generated automatically when saved'} readOnly tabIndex={-1}/></div><small className="text-muted">Generated from the selected category and stored as a unique ID.</small></div>
      <div className="col-md-6"><label>Membership From</label><input type="date" className={`form-control ${errors.membershipFrom ? 'is-invalid' : ''}`} {...register('membershipFrom')}/><div className="invalid-feedback">{errors.membershipFrom?.message}</div><small className="text-muted">The expiry date is calculated from the selected category validity. Lifetime memberships do not expire.</small></div>
      <div className="col-md-6"><label>Full Name</label><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.fullName ? 'is-invalid' : ''}`} {...register('fullName')}/><div className="invalid-feedback">{errors.fullName?.message}</div></div>
      <div className="col-md-6"><label>Member Email</label><input type="email" autoComplete="off" data-lpignore="true" className={`form-control ${errors.email ? 'is-invalid' : ''}`} placeholder="member@example.com" {...register('email')}/><div className="invalid-feedback">{errors.email?.message}</div><small className="text-muted">Profile confirmations and status notifications are sent here.</small></div>
      <div className="col-md-6"><label>Affiliation</label><input autoComplete="off" data-lpignore="true" className="form-control" {...register('affiliation')}/></div>
      <div className="col-md-6"><label>Country</label><select className="form-select" {...register('country')}><option value="">Select country</option>{countries.map(country => <option value={country} key={country}>{country}</option>)}</select></div>
      <div className="col-12"><label>Member’s Short Profile</label><textarea rows={4} autoComplete="off" data-lpignore="true" className={`form-control ${errors.shortProfile ? 'is-invalid' : ''}`} placeholder="A concise professional profile for the public members directory" {...register('shortProfile')}/><div className="invalid-feedback">{errors.shortProfile?.message}</div></div>
      <div className="col-md-6"><label>Photo</label><input type="file" accept="image/jpeg,image/png,image/webp" className="form-control" {...register('photo')}/><small className="text-muted">JPG, PNG, or WebP; maximum 2 MB.{editingMember?.photo ? ' Leave empty to keep the current photo.' : ''}</small></div>
      <div className="col-md-6"><label>Field of Expertise</label><input autoComplete="off" data-lpignore="true" className="form-control" {...register('fieldOfExpertise')}/></div>
      <div className="col-md-6"><label>Number of Research Papers Published</label><input type="number" min="0" className={`form-control ${errors.researchPapersPublished ? 'is-invalid' : ''}`} {...register('researchPapersPublished', { valueAsNumber: true })}/><div className="invalid-feedback">{errors.researchPapersPublished?.message}</div></div>
      <div className="col-md-6"><label>Member Status</label><select className="form-select" {...register('active')}><option value="true">Enabled — show publicly</option><option value="false">Disabled — hide publicly</option></select></div>
      <div className="col-md-6"><label>ORCID Profile Link</label><input type="url" autoComplete="off" data-lpignore="true" className={`form-control ${errors.orcid ? 'is-invalid' : ''}`} placeholder="https://orcid.org/0000-0000-0000-0000" {...register('orcid')}/><div className="invalid-feedback">{errors.orcid?.message}</div></div>
      <div className="col-md-6"><label>Google Scholar Profile Link</label><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.googleScholarUrl ? 'is-invalid' : ''}`} placeholder="scholar.google.com/…" {...register('googleScholarUrl')}/><div className="invalid-feedback">{errors.googleScholarUrl?.message}</div></div>
      <div className="col-md-6"><label>ResearchGate Profile Link</label><input autoComplete="off" data-lpignore="true" className={`form-control ${errors.researchGateUrl ? 'is-invalid' : ''}`} placeholder="researchgate.net/profile/…" {...register('researchGateUrl')}/><div className="invalid-feedback">{errors.researchGateUrl?.message}</div></div>
      <div className="col-12">{requestError && <div className="alert alert-danger py-2">{requestError}</div>}{notice && <div className="alert alert-success py-2">{notice}</div>}<div className="d-flex justify-content-end gap-2">{editingId && <button type="button" className="btn btn-outline-secondary" onClick={() => navigate('/admin/members')} disabled={isSubmitting}>Cancel</button>}<button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editingId ? 'Update Member' : 'Save Member'} <i className="bi bi-person-check ms-2"/></button></div></div>
    </div></form></div>}
    {mode === 'list' && <div className="users-table-card">
      <div className="table-title member-table-title"><h3>Member Records</h3><div className="member-table-tools"><div className="member-search"><i className="bi bi-search"/><input type="search" value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder="Search members" aria-label="Search by category, name, country, affiliation, membership ID, email, or status"/></div><select value={memberSort} onChange={event => setMemberSort(event.target.value)} aria-label="Sort member records"><option value="name-asc">Name: A–Z</option><option value="name-desc">Name: Z–A</option><option value="category">Category</option><option value="country">Country</option><option value="member-id">Membership ID</option><option value="status">Status</option></select><span>{visibleMembers.length} of {members.length}</span></div></div>
      {requestError && <div className="alert alert-danger m-3">{requestError}</div>}
      <div className="table-responsive"><table className="table align-middle member-records-table"><thead><tr><th>Photo</th><th>Membership ID</th><th>Membership Period</th><th>Full Name</th><th>Email</th><th>Category</th><th>Affiliation / Country</th><th>Papers</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {visibleMembers.length ? pagedMembers.map(member => { const expired = Boolean(member.membershipUntil && new Date(member.membershipUntil) <= new Date()); const status = member.active ? 'Enabled' : expired ? 'Expired' : 'Disabled'; return <tr key={member.id}>
          <td>{member.photo ? <img className="admin-member-photo" src={member.photo} alt=""/> : <span className="member-photo-placeholder"><i className="bi bi-person"/></span>}</td>
          <td><code>{member.membershipId || '—'}</code></td>
          <td className="member-period"><small>{member.membershipFrom ? new Date(member.membershipFrom).toLocaleDateString() : '—'}</small><small>{member.membershipUntil ? `Until ${new Date(member.membershipUntil).toLocaleDateString()}` : 'Lifetime'}</small></td>
          <td><b>{member.fullName}</b><small>{member.fieldOfExpertise || '—'}</small></td>
          <td>{member.email ? <a href={`mailto:${member.email}`}>{member.email}</a> : '—'}</td><td>{member.membershipCategory.name}</td>
          <td><div className="member-location"><span>{member.affiliation || '—'}</span><small><i className="bi bi-geo-alt"/>{member.country || '—'}</small></div></td><td>{member.researchPapersPublished}</td>
          <td><span className={`member-status-icon ${member.active ? 'active' : expired ? 'expired' : 'disabled'}`} title={status} aria-label={status}><i className={`bi ${member.active ? 'bi-eye-fill' : expired ? 'bi-hourglass-split' : 'bi-eye-slash-fill'}`}/></span></td>
          <td><div className="d-flex gap-1"><button className="btn btn-outline-primary member-action-icon" title="Edit" aria-label={`Edit ${member.fullName}`} onClick={() => edit(member)}><i className="bi bi-pencil"/></button><button className="btn btn-outline-danger member-action-icon" title="Delete" aria-label={`Delete ${member.fullName}`} onClick={() => remove(member)} disabled={deletingId === member.id}>{deletingId === member.id ? <span className="spinner-border spinner-border-sm"/> : <i className="bi bi-trash3"/>}</button></div></td>
        </tr>; }) : <tr><td colSpan={10} className="text-center text-muted py-4">{memberSearch ? 'No members match your search.' : 'No member records have been created.'}</td></tr>}
      </tbody></table></div><AdminPagination total={visibleMembers.length} page={memberPage} onPageChange={setMemberPage}/>
    </div>}
  </section>;
}
