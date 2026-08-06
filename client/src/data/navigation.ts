export type NavChild = { label: string; path: string };
export type NavItem = { label: string; path: string; children?: NavChild[] };

export const navigation: NavItem[] = [
  { label: 'Home', path: '/' },
  { label: 'About', path: '/about', children: [
    { label: 'About IJPAss', path: '/about/ijpass' }, { label: 'Vision & Mission', path: '/about/vision-mission' },
    { label: 'Leadership', path: '/about/leadership' }, { label: 'Aim', path: '/aim-scope/aim' },
    { label: 'Scope', path: '/aim-scope/scope' }, { label: 'Objectives', path: '/aim-scope/objectives' },
    { label: 'Contact Us', path: '/about/contact' }] },
  { label: 'Role of IJPAss', path: '/role', children: [
    { label: 'Publishing Excellence', path: '/role/publishing-excellence' }, { label: 'Research Integrity', path: '/role/research-integrity' },
    { label: 'International Collaboration', path: '/role/international-collaboration' }, { label: 'Digital Publishing', path: '/role/digital-publishing' },
    { label: 'Open Access', path: '/role/open-access' }] },
  { label: 'Membership', path: '/membership', children: [
    { label: 'Membership Categories', path: '/membership/categories' }, { label: 'Members List', path: '/membership/members' }, { label: 'Membership Benefits', path: '/membership/benefits' },
    { label: 'Membership Fees', path: '/membership/fees' }, { label: 'Apply for Membership', path: '/membership/apply' },
    { label: 'Renew Membership', path: '/membership/renew' }] },
  { label: 'Citation Database', path: '/indexing-db', children: [
    { label: 'Resources', path: '/indexing-db/resources' }, { label: 'Authors', path: '/indexing-db/authors' },
    { label: 'Affiliation', path: '/indexing-db/affiliations' }, { label: 'Country', path: '/indexing-db/countries' }] },
  { label: 'Journal Ranking', path: '/journal-ranking', children: [
    { label: 'Ranking Methodology', path: '/journal-ranking/methodology' }, { label: 'Journal Directory', path: '/journal-ranking/index' },
    { label: 'Submit Journal', path: '/journal-ranking/submit' }, { label: 'Evaluation Criteria', path: '/journal-ranking/criteria' },
    { label: 'Ranking Results', path: '/journal-ranking/results' }, { label: 'Citation Tracking', path: '/journal-ranking/citations' }] },
  { label: 'Contact', path: '/contact' }
];

export const pageCopy: Record<string, { title: string; eyebrow: string; text: string }> = {};
navigation.forEach((item) => {
  pageCopy[item.path] = { title: item.label, eyebrow: 'International Journal Publishers Association', text: `Explore IJPAss ${item.label.toLowerCase()} resources, services, and information for the global scholarly publishing community.` };
  item.children?.forEach((child) => pageCopy[child.path] = { title: child.label, eyebrow: item.label, text: `Discover our approach to ${child.label.toLowerCase()} and how IJPAss supports trusted, visible, and impactful scholarly publishing.` });
});

Object.assign(pageCopy, {
  '/about': { title: 'About', eyebrow: 'International Journal Publishers Association', text: 'A global professional body strengthening scholarly publishing through quality, integrity, innovation, and collaboration.' },
  '/about/ijpass': { title: 'About IJPAss', eyebrow: 'About', text: 'Advancing the quality, visibility, credibility, and global impact of scholarly journals across all academic disciplines.' },
  '/aim-scope': { title: 'Aim & Scope', eyebrow: 'Our Direction', text: 'Promoting excellence, ethical publishing, research visibility, reliable quality assessment, and international recognition.' },
  '/aim-scope/aim': { title: 'Aim', eyebrow: 'Aim & Scope', text: 'Strengthening scholarly publishing and enhancing the visibility, quality, integrity, and impact of academic journals.' },
  '/aim-scope/scope': { title: 'Scope', eyebrow: 'Aim & Scope', text: 'Supporting every part of the global scholarly publishing ecosystem across all academic disciplines.' },
  '/aim-scope/objectives': { title: 'Objectives', eyebrow: 'Aim & Scope', text: 'A practical framework for trusted, visible, ethical, and internationally recognized scholarly publishing.' },
  '/role': { title: 'Role of IJPAss', eyebrow: 'Global Professional Body', text: 'Connecting the scholarly community to advance publishing quality, integrity, innovation, and international collaboration.' },
  '/membership': { title: 'Membership', eyebrow: 'Join the Association', text: 'Membership pathways for students, professionals, journals, publishers, institutions, companies, and distinguished contributors.' },
  '/membership/categories': { title: 'Membership Categories', eyebrow: 'Membership', text: 'Choose the IJPAss membership category that best represents your role in scholarly publishing.' },
  '/membership/benefits': { title: 'Membership Benefits', eyebrow: 'Membership', text: 'Professional recognition, resources, training, visibility, collaboration, and publishing support tailored to every member category.' },
  '/membership/fees': { title: 'Membership Fees', eyebrow: 'Membership', text: 'Clear annual and lifetime membership options for the international scholarly publishing community.' },
  '/indexing-db': { title: 'Indexing DB', eyebrow: 'Scholarly Data', text: 'Search indexed resources, authors, affiliations, countries, publications, and research-impact metrics.' },
  '/journal-ranking': { title: 'Journal Ranking', eyebrow: 'Quality & Recognition', text: 'Objective evaluation based on editorial quality, peer review, publication standards, citations, research impact, and ethical compliance.' },
  '/journal-ranking/citations': { title: 'Citation Tracking', eyebrow: 'Journal Ranking', text: 'Publication metrics that reveal the influence, visibility, and research impact of journals and articles.' }
});
