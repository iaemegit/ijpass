import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { navigation, pageCopy } from '../data/navigation';
import { contentByPath, membershipBenefits, membershipFees, optionalServices } from '../data/content';
import { api } from '../lib/auth';
import { formatCurrency } from '../lib/currency';

type MembershipCategory = { id: number | string; name: string; eligibility: string; validity: string; usd: string; inr: string };
const fallbackCategories: MembershipCategory[] = membershipFees.map(([name, eligibility, validity, usd, inr]) => ({ id: name, name, eligibility, validity, usd, inr }));

const categoryPresentation = (name: string, index: number) => {
  const normalized = name.toLowerCase();
  const choices = [
    { match: 'student', icon: 'bi-mortarboard', about: 'Designed for students and emerging researchers beginning their scholarly journey. It provides opportunities to learn, connect, and participate in the academic publishing community.' },
    { match: 'life', icon: 'bi-infinity', about: 'Created for professionals seeking lasting recognition within IJPAss. Life membership provides continued association with the scholarly publishing community without annual renewal.' },
    { match: 'honorary', icon: 'bi-award', about: 'Reserved for distinguished scholars and leaders who have made exceptional contributions. It recognizes sustained service to research, education, and scholarly publishing.' },
    { match: 'fellow', icon: 'bi-stars', about: 'Advanced recognition for senior professionals with outstanding achievements. Fellowship highlights leadership, expertise, and sustained service to scholarly publishing.' },
    { match: 'editor', icon: 'bi-pencil-square', about: 'Developed for editors and editorial board professionals responsible for journal quality. It supports ethical peer review, editorial leadership, and responsible journal management.' },
    { match: 'journal', icon: 'bi-journal-bookmark', about: 'Designed for scholarly journals working to improve publishing standards. It supports stronger editorial quality, research visibility, evaluation, and international recognition.' },
    { match: 'publisher', icon: 'bi-building', about: 'Created for publishing organizations managing one or more scholarly journals. It supports credible publishing practices, professional collaboration, visibility, and sustainable growth.' },
    { match: 'institution', icon: 'bi-bank', about: 'Intended for universities, colleges, libraries, and research institutions. It encourages institutional collaboration, professional development, and stronger scholarly communication.' },
    { match: 'corporate', icon: 'bi-briefcase', about: 'Designed for companies that support scholarly publishing and research communication. It creates opportunities for partnership, innovation, professional networking, and industry engagement.' },
    { match: 'individual', icon: 'bi-person-badge', about: 'Created for researchers, authors, reviewers, academicians, and librarians. It connects professionals with resources, recognition, and opportunities across scholarly publishing.' }
  ];
  const fallbackIcons = ['bi-people', 'bi-globe2', 'bi-lightbulb', 'bi-patch-check', 'bi-book', 'bi-diagram-3'];
  return choices.find(choice => normalized.includes(choice.match)) || { icon: fallbackIcons[index % fallbackIcons.length], about: `A dedicated membership pathway for eligible ${name.toLowerCase()} applicants. It provides access to relevant IJPAss resources, recognition, and professional opportunities.` };
};

export default function ContentPage() {
  const { pathname } = useLocation();
  const copy = pageCopy[pathname] || { title: 'Page not found', eyebrow: 'IJPAss', text: 'The page you requested could not be found.' };
  const group = navigation.find(item => item.path === pathname || item.children?.some(child => child.path === pathname));
  const sections = contentByPath[pathname];
  const showFees = pathname === '/membership' || pathname === '/membership/categories' || pathname === '/membership/fees';
  const showBenefits = pathname === '/membership' || pathname === '/membership/benefits';
  const showCategoryCards = pathname === '/membership/categories';
  const [membershipCategories, setMembershipCategories] = useState<MembershipCategory[]>(fallbackCategories);

  useEffect(() => {
    if (showFees) api.get<{ categories: MembershipCategory[] }>('/membership-categories').then(({ data }) => { if (data.categories.length) setMembershipCategories(data.categories); }).catch(() => undefined);
  }, [showFees]);

  return <>
    <section className="page-hero"><div className="container"><div className="breadcrumb-line"><Link to="/">Home</Link><i className="bi bi-chevron-right"/>{group && group.path !== pathname && <><Link to={group.path}>{group.label}</Link><i className="bi bi-chevron-right"/></>}<span>{copy.title}</span></div><span className="eyebrow-light">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.text}</p></div></section>
    <section className="section-space"><div className="container"><div className="row g-5">
      <aside className="col-lg-3">{group?.children && <div className="side-nav"><h6>{group.label}</h6>{group.children.map(child => <Link key={child.path} className={child.path === pathname ? 'active' : ''} to={child.path}>{child.label}<i className="bi bi-chevron-right"/></Link>)}</div>}</aside>
      <div className={group?.children ? 'col-lg-8 offset-lg-1' : 'col-lg-9'}>
        <span className="eyebrow">{showCategoryCards ? 'Membership options' : 'Overview'}</span>
        <h2>{showCategoryCards ? <>Membership designed for every <span>scholarly role.</span></> : <>Building quality, trust, and <span>global impact.</span></>}</h2>
        <p className="content-lead">{copy.text}</p>

        {sections?.map((section, index) => <section className="editorial-section" key={index}>{section.heading && <h3>{section.heading}</h3>}{section.paragraphs?.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}{section.bullets && <ul className="objective-list">{section.bullets.map((item, itemIndex) => <li key={itemIndex}><span>{String(itemIndex + 1).padStart(2, '0')}</span><p>{item}</p></li>)}</ul>}</section>)}

        {showFees && showCategoryCards && <section className="editorial-section membership-category-section">
          <div className="membership-category-intro"><div><span className="eyebrow">Explore categories</span><h3>Find your place in the IJPAss community</h3></div><p>Each category provides a clear pathway to professional recognition, collaboration, and engagement in responsible scholarly publishing.</p></div>
          <div className="membership-category-cards">{membershipCategories.map((category, index) => {
            const presentation = categoryPresentation(category.name, index);
            return <article className="card membership-category-card" key={category.id}>
              <div className="membership-category-card-head"><span className="membership-category-icon"><i className={`bi ${presentation.icon}`}/></span><div><h3>{category.name}</h3></div><span className="membership-validity-badge"><i className="bi bi-calendar-check"/>{category.validity}</span></div>
              <div className="membership-category-about"><p>{presentation.about}</p></div>
              <div className="membership-category-details"><div className="membership-eligibility"><span><i className="bi bi-person-check"/>Eligibility</span><p>{category.eligibility}</p></div><div className="membership-validity"><span><i className="bi bi-hourglass-split"/>Validity</span><strong>{category.validity}</strong></div><div className="membership-fees"><span><i className="bi bi-wallet2"/>Membership fee</span><div><div><small>USD</small><strong>{formatCurrency(category.usd, '$')}</strong></div><div><small>INR</small><strong>{formatCurrency(category.inr, '₹')}</strong></div></div></div></div>
              <div className="membership-category-card-foot"><span><i className="bi bi-shield-check"/>Transparent eligibility and fee information</span><Link to="/membership/apply">Apply for membership <i className="bi bi-arrow-right"/></Link></div>
            </article>;
          })}</div>
          <p className="membership-fee-note"><i className="bi bi-info-circle"/>Membership fees may be reviewed and updated by the Association.</p>
        </section>}

        {showFees && !showCategoryCards && <section className="editorial-section"><h3>Membership categories and fees</h3><div className="table-responsive membership-table-wrap"><table className="table membership-table"><thead><tr><th>Category</th><th>Eligibility</th><th>Validity</th><th>USD</th><th>INR</th></tr></thead><tbody>{membershipCategories.map(category => <tr key={category.id}><td>{category.name}</td><td>{category.eligibility}</td><td>{category.validity}</td><td>{formatCurrency(category.usd, '$')}</td><td>{formatCurrency(category.inr, '₹')}</td></tr>)}</tbody></table></div><p className="small text-muted">Membership fees are presented as suggested rates and may be updated by the Association.</p></section>}

        {showBenefits && <section className="editorial-section"><h3>Benefits by membership category</h3><div className="benefit-grid">{membershipBenefits.map(([name, benefits]) => <div className="benefit-card" key={name}><div className="benefit-icon"><i className="bi bi-patch-check"/></div><h4>{name}</h4><ul>{benefits.map(item => <li key={item}>{item}</li>)}</ul></div>)}</div><h3 className="mt-5">Optional professional services</h3><p>Members may request additional specialist services for separate fees.</p><div className="service-tags">{optionalServices.map(item => <span key={item}><i className="bi bi-check2"/>{item}</span>)}</div></section>}

        {!sections && !showFees && !showBenefits && <><p>This page is prepared for further approved service information, application requirements, policies, or live data as they become available.</p><div className="info-grid"><div><i className="bi bi-shield-check"/><h4>Trusted framework</h4><p>Clear, transparent standards aligned with responsible scholarly communication.</p></div><div><i className="bi bi-globe2"/><h4>International outlook</h4><p>A globally inclusive perspective supporting diverse publishing communities.</p></div></div></>}
        <div className="inline-cta"><div><h4>Ready to learn more?</h4><p>Speak with the IJPAss team for guidance and support.</p></div><Link to="/contact" className="btn btn-primary">Contact our team</Link></div>
      </div>
    </div></div></section>
  </>;
}
