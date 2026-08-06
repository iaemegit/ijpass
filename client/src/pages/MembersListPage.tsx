import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/auth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogleScholar, faOrcid, faResearchgate } from '@fortawesome/free-brands-svg-icons';

type Category = { id: number; name: string; sortOrder: number };
type Member = { id: number; name: string; category: string; affiliation?: string | null; country?: string | null; photo?: string | null; shortProfile?: string | null; fieldOfExpertise?: string | null; researchPapersPublished: number; googleScholarUrl?: string | null; researchGateUrl?: string | null; orcid?: string | null };

const orcidHref = (value: string) => /^https?:\/\//i.test(value) ? value : `https://orcid.org/${value}`;
const memberPath = (name: string) => `/membership/members/${encodeURIComponent(name.trim().replace(/\s+/g, '_'))}`;

export default function MembersListPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api.get<{ categories: Category[]; members: Member[] }>('/members', { params: query.trim() ? { q: query.trim() } : undefined, signal: controller.signal })
        .then(({ data }) => { setCategories(data.categories); setMembers(data.members); })
        .catch(requestError => { if (requestError.code !== 'ERR_CANCELED') setError('The members directory could not be loaded. Please try again.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query.trim() ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    if (!suggestionsEnabled || query.trim().length < 2) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.get<{ suggestions: string[] }>('/members/suggestions', { params: { q: query.trim() }, signal: controller.signal })
        .then(({ data }) => setSuggestions(data.suggestions || []))
        .catch(() => setSuggestions([]));
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, suggestionsEnabled]);

  const groups = useMemo(() => categories.map(category => ({ ...category, members: members.filter(member => member.category === category.name) })).filter(group => group.members.length), [categories, members]);

  return <>
    <section className="page-hero"><div className="container"><div className="breadcrumb-line"><Link to="/">Home</Link><i className="bi bi-chevron-right"/><Link to="/membership">Membership</Link><i className="bi bi-chevron-right"/><span>Members List</span></div><span className="eyebrow-light">IJPAss Directory</span><h1>Members List</h1><p>Explore registered IJPAss members organized by membership category.</p></div></section>
    <section className="section-space members-directory"><div className="container">
      <div className="members-toolbar"><div><span className="eyebrow">Member directory</span><h2>Find an IJPAss <span>member.</span></h2><p>Search the directory by member or organization name.</p></div><div className="member-search member-search-autocomplete"><i className="bi bi-search"/><input type="search" value={query} onChange={event => { setQuery(event.target.value); setSuggestionsEnabled(true); }} placeholder="Search name, affiliation or country" aria-label="Search members" autoComplete="off" aria-autocomplete="list" aria-expanded={suggestions.length > 0}/><button type="button" onClick={() => { setQuery(''); setSuggestions([]); }} className={query ? '' : 'invisible'} aria-label="Clear search"><i className="bi bi-x-lg"/></button>{suggestions.length > 0 && <div className="search-autocomplete-menu" role="listbox">{suggestions.map((name) => <button type="button" key={name} role="option" onClick={() => { setQuery(name); setSuggestions([]); setSuggestionsEnabled(false); }}><i className="bi bi-person"/><span>{name}</span></button>)}</div>}</div></div>
      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="directory-state"><span className="spinner-border text-success"/><p>Loading members…</p></div>}
      {!loading && !groups.length && <div className="directory-state"><i className="bi bi-people"/><h3>{query ? 'No matching members' : 'No members are currently listed'}</h3><p>{query ? `No member name matches “${query}”.` : 'Approved member records will appear here by category.'}</p></div>}
      {!loading && groups.map(group => <section className="member-category member-card-group" key={group.id}>
        <div className="member-category-heading"><div><span className="category-icon"><i className="bi bi-patch-check"/></span><div><h3>{group.name}</h3><p>{group.members.length} member{group.members.length === 1 ? '' : 's'}</p></div></div></div>
        <div className="row row-cols-1 row-cols-md-2 row-cols-xl-4 g-3 member-card-grid">{group.members.map(member => <div className="col" key={member.id}><article className="member-profile-card">
          <div className="member-card-top">{member.photo ? <img className="member-card-photo" src={member.photo} alt={`${member.name} profile`}/> : <span className="member-card-photo member-card-photo-placeholder"><i className="bi bi-person"/></span>}<span className="member-category-badge">{member.category}</span></div>
          <h4><Link to={memberPath(member.name)}>{member.name}</Link></h4>
          <div className="member-identity"><p><i className="bi bi-building"/>{member.affiliation || 'Independent Member'}</p><p><i className="bi bi-geo-alt"/>{member.country || 'Country not specified'}</p></div>
          {member.fieldOfExpertise && <p className="member-expertise"><i className="bi bi-lightbulb"/>{member.fieldOfExpertise}</p>}
          <p className="member-paper-count"><strong>Research Papers:</strong> {member.researchPapersPublished}</p>
          <div className="member-profile-links">
            {member.orcid && <a className="orcid" href={orcidHref(member.orcid)} target="_blank" rel="noreferrer" title="ORCID profile" aria-label={`${member.name} ORCID profile`}><FontAwesomeIcon icon={faOrcid}/></a>}
            {member.googleScholarUrl && <a className="google-scholar" href={member.googleScholarUrl} target="_blank" rel="noreferrer" title="Google Scholar profile" aria-label={`${member.name} Google Scholar profile`}><FontAwesomeIcon icon={faGoogleScholar}/></a>}
            {member.researchGateUrl && <a className="researchgate" href={member.researchGateUrl} target="_blank" rel="noreferrer" title="ResearchGate profile" aria-label={`${member.name} ResearchGate profile`}><FontAwesomeIcon icon={faResearchgate}/></a>}
          </div>
          <Link className="member-view-profile" to={memberPath(member.name)}>View Profile <i className="bi bi-arrow-right"/></Link>
        </article></div>)}</div>
      </section>)}
    </div></section>
  </>;
}
