import { useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import InternalUserManager from './InternalUserManager';
import type { PortalUser } from '../lib/auth';
import ContactEnquiryList from './ContactEnquiryList';
import MembershipCategoryManager from './MembershipCategoryManager';
import PublisherManager from './PublisherManager';
import MemberManager from './MemberManager';
import MembershipApplicationList from './MembershipApplicationList';
import AdminPagination, { ADMIN_PAGE_SIZE, pageSlice } from './AdminPagination';
import AdminTableControls from './AdminTableControls';

type Summary = { users: number; journals: number; applications: number; messages: number };
type ModuleId = 'overview' | 'internal-users' | 'publishers' | 'journals' | 'membership-categories' | 'members' | 'ranking' | 'applications' | 'contacts' | 'settings';
const modules: { id: ModuleId; label: string; icon: string; group: string; path: string }[] = [
  { id: 'overview', label: 'Dashboard Overview', icon: 'bi-grid-1x2', group: 'Dashboard', path: '/admin/dashboard' },
  { id: 'internal-users', label: 'Internal Users', icon: 'bi-person-gear', group: 'Account Forms', path: '/admin/internal-users' },
  { id: 'publishers', label: 'Publisher Accounts', icon: 'bi-building-add', group: 'Account Forms', path: '/admin/publishers' },
  { id: 'journals', label: 'Journal Entry', icon: 'bi-journal-plus', group: 'Data Entry Forms', path: '/admin/journals' },
  { id: 'membership-categories', label: 'Membership Categories', icon: 'bi-person-vcard', group: 'Data Entry Forms', path: '/admin/membership-categories' },
  { id: 'members', label: 'Members List', icon: 'bi-people', group: 'Data Entry Forms', path: '/admin/members' },
  { id: 'ranking', label: 'Ranking & Citations', icon: 'bi-bar-chart-line', group: 'Data Entry Forms', path: '/admin/ranking-citations' },
  { id: 'applications', label: 'Membership Applications', icon: 'bi-file-earmark-person', group: 'Records', path: '/admin/membership-applications' },
  { id: 'contacts', label: 'Contact Enquiries', icon: 'bi-envelope-paper', group: 'Records', path: '/admin/contact-enquiries' },
  { id: 'settings', label: 'Portal Settings', icon: 'bi-sliders', group: 'System', path: '/admin/settings' }
];

function DraftForm({ type, onBack }: { type: 'journals' | 'ranking'; onBack: () => void }) {
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); setSaved(true); };
  const definitions = {
    journals: { title: 'Add Journal Record', text: 'Enter core journal and publisher information for the IJPAss directory.', fields: [['Journal title','text'],['ISSN / E-ISSN','text'],['Publisher','text'],['Country','text'],['Primary discipline','text'],['Journal website','url']] },
    ranking: { title: 'Journal Ranking & Citation Entry', text: 'Record evaluation, ranking, and citation-performance information.', fields: [['Journal / ISSN','text'],['Evaluation year','number'],['Quality score','number'],['Ranking grade','text'],['Citation count','number'],['Evaluation notes','text']] }
  }[type];
  return <><div className="manager-heading"><div><span className="eyebrow">Super Admin controls</span><h2>{definitions.title}</h2><p>{definitions.text}</p></div><button className="btn btn-outline-secondary" onClick={onBack}><i className="bi bi-arrow-left me-2"/>Back to list</button></div><div className="admin-form-card"><div className="admin-panel-heading"><span className="form-icon"><i className="bi bi-pencil-square"/></span><div><h2>{definitions.title}</h2><p>Complete all required record details.</p></div></div><form onSubmit={submit} autoComplete="off"><div className="row g-3">{definitions.fields.map(([label,inputType])=><div className="col-md-6" key={label}><label>{label}</label><input required type={inputType} autoComplete={inputType === 'password' ? 'new-password' : 'off'} data-lpignore="true" className="form-control"/></div>)}<div className="col-12"><label>Internal remarks</label><textarea autoComplete="off" data-lpignore="true" className="form-control" rows={3}/></div><div className="col-12 d-flex justify-content-end gap-2"><button type="reset" className="btn btn-outline-secondary" onClick={()=>setSaved(false)}>Clear</button><button className="btn btn-primary">Save Record <i className="bi bi-check2 ms-2"/></button></div>{saved&&<div className="col-12"><div className="alert alert-info mb-0"><i className="bi bi-info-circle me-2"/>Form layout is ready. Database submission will activate with the corresponding record module.</div></div>}</div></form></div></>;
}

function RecordList({ type, onAdd }: { type: 'journals' | 'ranking' | 'settings'; onAdd: () => void }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('default');
  const definitions = {
    journals: { title: 'Journal Records', text: 'Manage journals in the IJPAss directory.', headers: ['Journal Title', 'ISSN / E-ISSN', 'Publisher', 'Country', 'Discipline'] },
    ranking: { title: 'Ranking & Citation Records', text: 'Manage journal evaluation and citation records.', headers: ['Journal / ISSN', 'Year', 'Quality Score', 'Grade', 'Citations'] },
    settings: { title: 'Portal Settings', text: 'Manage organization and system-setting records.', headers: ['Association', 'Support Email', 'Status'] }
  }[type];
  const rows = type === 'settings' ? [['International Journal Publishers Association', 'info@ijpass.com', 'Active']] : [];
  const visibleRows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const filtered = rows.filter(row => !search || row.some(cell => cell.toLocaleLowerCase().includes(search)));
    if (!sortBy.startsWith('column-')) return filtered;
    const column = Number(sortBy.slice(7));
    return [...filtered].sort((first, second) => (first[column] || '').localeCompare(second[column] || '', undefined, { sensitivity: 'base', numeric: true }));
  }, [query, rows, sortBy]);
  return <section><div className="manager-heading"><div><span className="eyebrow">Super Admin records</span><h2>{definitions.title}</h2><p>{definitions.text}</p></div><button className="btn btn-primary" onClick={onAdd}><i className="bi bi-plus-lg me-2"/>Add New</button></div><div className="users-table-card"><div className="table-title admin-list-title"><h3>{definitions.title} List</h3><AdminTableControls query={query} onQueryChange={value => { setQuery(value); setPage(1); }} placeholder={`Search ${definitions.headers.join(', ')}`} sort={sortBy} onSortChange={value => { setSortBy(value); setPage(1); }} options={[{value:'default',label:'Default order'},...definitions.headers.map((header,index)=>({value:`column-${index}`,label:`${header} A–Z`}))]}/><span>{visibleRows.length} of {rows.length}</span></div><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Sl. No.</th>{definitions.headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{visibleRows.length ? pageSlice(visibleRows, page).map((row,index)=><tr key={index}><td>{(page - 1) * ADMIN_PAGE_SIZE + index + 1}</td>{row.map((cell,cellIndex)=><td key={cellIndex}>{cell}</td>)}</tr>) : <tr><td colSpan={definitions.headers.length+1} className="text-center text-muted py-4">{query ? 'No records match your search.' : 'No records found. Use Add New to create the first record.'}</td></tr>}</tbody></table></div><AdminPagination total={visibleRows.length} page={page} onPageChange={setPage}/></div></section>;
}

function SettingsForm({ onBack }: { onBack: () => void }) {
  return <><div className="manager-heading"><div><span className="eyebrow">Super Admin controls</span><h2>Add Portal Setting</h2><p>Create an organization or system-setting record.</p></div><button className="btn btn-outline-secondary" onClick={onBack}><i className="bi bi-arrow-left me-2"/>Back to list</button></div><div className="admin-form-card"><form autoComplete="off"><div className="row g-3"><div className="col-md-6"><label>Association name</label><input autoComplete="off" data-lpignore="true" className="form-control" defaultValue="International Journal Publishers Association"/></div><div className="col-md-6"><label>Support email</label><input autoComplete="off" data-lpignore="true" className="form-control" defaultValue="info@ijpass.com"/></div><div className="col-12"><button className="btn btn-primary">Save Settings</button></div></div></form></div></>;
}

export default function AdminWorkspace({ user, summary, logout }: { user: PortalUser; summary: Summary; logout: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const active = modules.find(module => location.pathname === module.path || location.pathname.startsWith(`${module.path}/`))?.id ?? 'overview';
  const isAddNew = location.pathname.endsWith('/addnew');
  const openModule = (module: ModuleId) => navigate(modules.find(item => item.id === module)?.path || '/admin/dashboard');
  const groups = [...new Set(modules.map(module => module.group))];
  const renderPanel = () => {
    if (active === 'internal-users') return <InternalUserManager mode={isAddNew ? 'form' : 'list'}/>;
    if (active === 'publishers') return <PublisherManager mode={isAddNew ? 'form' : 'list'}/>;
    if (active === 'membership-categories') return <MembershipCategoryManager mode={isAddNew ? 'form' : 'list'}/>;
    if (active === 'members') return <MemberManager mode={isAddNew ? 'form' : 'list'}/>;
    if (active === 'journals' || active === 'ranking') return isAddNew ? <DraftForm type={active} onBack={() => openModule(active)}/> : <RecordList type={active} onAdd={() => navigate(`${modules.find(item => item.id === active)!.path}/addnew`)}/>;
    if (active === 'contacts') return <ContactEnquiryList/>;
    if (active === 'applications') return <MembershipApplicationList/>;
    if (active === 'settings') return isAddNew ? <SettingsForm onBack={() => openModule('settings')}/> : <RecordList type="settings" onAdd={() => navigate('/admin/settings/addnew')}/>;
    return <><div className="admin-welcome"><div><span className="eyebrow">Super Admin dashboard</span><h1>Welcome, {user.name}</h1><p>Manage accounts, journals, applications, rankings, and association records.</p></div><span className="admin-role"><i className="bi bi-shield-check"/>Super Admin</span></div><div className="portal-grid">{[['bi-people','Users',summary.users],['bi-journals','Journals',summary.journals],['bi-file-earmark-check','Applications',summary.applications],['bi-envelope','Enquiries',summary.messages]].map(([icon,title,value])=><div className="portal-card" key={String(title)}><i className={`bi ${icon}`}/><div><span>{title}</span><strong>{value}</strong></div></div>)}</div><div className="quick-forms"><h2>Quick access to forms</h2><div>{modules.filter(module=>['internal-users','publishers','journals','membership-categories'].includes(module.id)).map(module=><button key={module.id} onClick={()=>openModule(module.id)}><i className={`bi ${module.icon}`}/><span>{module.label}</span><i className="bi bi-arrow-right"/></button>)}</div></div></>;
  };
  return <div className={`admin-dashboard ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><aside className="admin-sidebar"><div className="admin-sidebar-head"><span className="brand-mark">IJ</span><div><strong>IJPAss Admin</strong><small>Data Management Portal</small></div><button type="button" className="admin-sidebar-toggle" onClick={() => setSidebarCollapsed(value => !value)} title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'} aria-label={sidebarCollapsed ? 'Expand left menu' : 'Collapse left menu'}><i className={`bi ${sidebarCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`}/></button></div><nav>{groups.map(group=><div className="admin-nav-group" key={group}><span>{group}</span>{modules.filter(module=>module.group===group).map(module=><button className={active===module.id?'active':''} key={module.id} onClick={()=>openModule(module.id)} title={sidebarCollapsed ? module.label : undefined}><i className={`bi ${module.icon}`}/>{module.label}</button>)}</div>)}</nav><div className="admin-user"><div className="admin-avatar">{user.name.slice(0,2).toUpperCase()}</div><div><b>{user.name}</b><small>{user.email}</small></div><button onClick={logout} title="Sign out"><i className="bi bi-box-arrow-right"/></button></div></aside><main className="admin-workspace"><div className="admin-mobile-bar"><select value={active} onChange={event=>openModule(event.target.value as ModuleId)}>{modules.map(module=><option value={module.id} key={module.id}>{module.label}</option>)}</select><button onClick={logout} title="Sign out"><i className="bi bi-box-arrow-right"/></button></div>{renderPanel()}</main></div>;
}
