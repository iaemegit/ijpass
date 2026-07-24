import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/auth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogleScholar, faOrcid, faResearchgate } from '@fortawesome/free-brands-svg-icons';

type Member = {
  id: number;
  name: string;
  category: string;
  affiliation?: string | null;
  country?: string | null;
  photo?: string | null;
  shortProfile?: string | null;
  fieldOfExpertise?: string | null;
  researchPapersPublished: number;
  googleScholarUrl?: string | null;
  researchGateUrl?: string | null;
  orcid?: string | null;
};

const orcidHref = (value: string) => /^https?:\/\//i.test(value) ? value : `https://orcid.org/${value}`;

export default function MemberProfilePage() {
  const { memberName = '' } = useParams();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    setMember(null);
    api.get<{ member: Member }>(`/members/${encodeURIComponent(memberName)}`)
      .then(({ data }) => setMember(data.member))
      .catch(error => setError(error?.response?.status === 404 ? 'This member profile is not available.' : 'The member profile could not be loaded. Please try again.'))
      .finally(() => setLoading(false));
  }, [memberName]);

  return <>
    <section className="page-hero member-profile-hero"><div className="container">
      <div className="breadcrumb-line"><Link to="/">Home</Link><i className="bi bi-chevron-right"/><Link to="/membership">Membership</Link><i className="bi bi-chevron-right"/><Link to="/membership/members">Members List</Link><i className="bi bi-chevron-right"/><span>{member?.name || 'Member Profile'}</span></div>
      <span className="eyebrow-light">IJPAss Member Directory</span><h1>Member Profile</h1><p>Professional and scholarly information for an IJPAss member.</p>
    </div></section>
    <section className="section-space"><div className="container">
      {loading && <div className="directory-state"><span className="spinner-border text-success"/><p>Loading member profile…</p></div>}
      {!loading && error && <div className="member-profile-error"><i className="bi bi-person-x"/><h2>Profile unavailable</h2><p>{error}</p><Link className="btn btn-primary" to="/membership/members"><i className="bi bi-arrow-left me-2"/>Back to Members List</Link></div>}
      {!loading && member && <article className="public-member-profile">
        <aside className="public-member-sidebar">
          {member.photo ? <img src={member.photo} alt={`${member.name} profile`}/> : <span className="public-member-photo-placeholder"><i className="bi bi-person"/></span>}
          <span className="member-category-badge">{member.category}</span>
          <h2>{member.name}</h2>
          <p><i className="bi bi-building"/>{member.affiliation || 'Independent Member'}</p>
          <p><i className="bi bi-geo-alt"/>{member.country || 'Country not specified'}</p>
          <Link className="public-member-back" to="/membership/members"><i className="bi bi-arrow-left"/> All Members</Link>
        </aside>
        <div className="public-member-content">
          <section><span className="eyebrow">Professional profile</span><h3>About {member.name}</h3><p className="public-member-biography">{member.shortProfile || 'A short professional profile has not been provided.'}</p></section>
          <div className="public-member-facts">
            <div><i className="bi bi-lightbulb"/><span>Field of Expertise</span><strong>{member.fieldOfExpertise || 'Not specified'}</strong></div>
            <div><i className="bi bi-file-earmark-text"/><span>Research Papers Published</span><strong>{member.researchPapersPublished}</strong></div>
            <div><i className="bi bi-patch-check"/><span>Membership Category</span><strong>{member.category}</strong></div>
            <div><i className="bi bi-geo-alt"/><span>Country</span><strong>{member.country || 'Not specified'}</strong></div>
          </div>
          <section className="public-member-links-section"><span className="eyebrow">Research profiles</span><h3>Scholarly links</h3><div className="public-member-links">
            {member.orcid && <a className="orcid" href={orcidHref(member.orcid)} target="_blank" rel="noreferrer"><span className="research-brand-icon"><FontAwesomeIcon icon={faOrcid}/></span><span className="public-member-link-copy"><small>ORCID</small><strong>View ORCID Profile</strong></span><i className="bi bi-box-arrow-up-right"/></a>}
            {member.googleScholarUrl && <a className="google-scholar" href={member.googleScholarUrl} target="_blank" rel="noreferrer"><span className="research-brand-icon"><FontAwesomeIcon icon={faGoogleScholar}/></span><span className="public-member-link-copy"><small>Google Scholar</small><strong>View Scholar Profile</strong></span><i className="bi bi-box-arrow-up-right"/></a>}
            {member.researchGateUrl && <a className="researchgate" href={member.researchGateUrl} target="_blank" rel="noreferrer"><span className="research-brand-icon"><FontAwesomeIcon icon={faResearchgate}/></span><span className="public-member-link-copy"><small>ResearchGate</small><strong>View ResearchGate Profile</strong></span><i className="bi bi-box-arrow-up-right"/></a>}
            {!member.orcid && !member.googleScholarUrl && !member.researchGateUrl && <p className="text-muted mb-0">No external research profiles have been added.</p>}
          </div></section>
        </div>
      </article>}
    </div></section>
  </>;
}
