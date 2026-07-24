export type ContentSection = { heading?: string; paragraphs?: string[]; bullets?: string[] };

const objectives = [
  'Promote excellence and ethical standards in scholarly and academic publishing.',
  'Establish and maintain a transparent framework for the evaluation, ranking, and recognition of academic journals based on quality indicators and publishing best practices.',
  'Develop and support citation tracking systems that measure the academic influence and research impact of published articles and journals.',
  'Encourage journals to improve editorial standards, peer-review processes, publication ethics, and overall quality.',
  'Facilitate the indexing and abstracting of member journals in national and international databases.',
  'Promote responsible open-access publishing and sustainable publishing models.',
  'Provide guidance on publication ethics, plagiarism prevention, copyright management, and research integrity.',
  'Organize conferences, workshops, seminars, webinars, and training programs for publishers, editors, reviewers, and researchers.',
  'Encourage worldwide collaboration among publishers, academic institutions, research organizations, libraries, and professional societies.',
  'Support digital publishing technologies, metadata standards, digital preservation, and interoperable publishing platforms.',
  'Recognize outstanding journals, editors, reviewers, and researchers through awards, certifications, and quality recognition programs.',
  'Collect, analyze, and report publication metrics including citation counts, journal performance, article usage, and research visibility.',
  'Help journals improve their international presence, discoverability, and academic reputation through quality enhancement initiatives.',
  'Encourage multidisciplinary and interdisciplinary research dissemination for the global scientific and academic community.',
  'Foster transparency, accountability, and continuous improvement through internationally accepted publishing standards.'
];

export const contentByPath: Record<string, ContentSection[]> = {
  '/about': [{ heading: 'A professional platform for scholarly publishing', paragraphs: ['The International Journal Publishers Association (IJPAss) is committed to advancing the quality, visibility, credibility, and global impact of scholarly journals across all academic disciplines.', 'The Association serves journal publishers, editors, reviewers, researchers, librarians, and academic institutions by promoting ethical publishing, rigorous peer review, digital innovation, indexing, citation analysis, journal ranking, research integrity, and international collaboration.'] }],
  '/about/ijpass': [{ heading: 'About the Association', paragraphs: ['The International Journal Publishers Association (IJPAss) is a global professional body dedicated to strengthening scholarly publishing through quality, integrity, innovation, and international collaboration.', 'IJPAss supports sustainable, transparent, and globally recognized scholarly publishing standards while connecting publishers, editors, researchers, institutions, libraries, and policymakers.'] }],
  '/aim-scope': [{ heading: 'Our commitment', paragraphs: ['IJPAss advances quality, visibility, credibility, and global impact across all fields of scholarly publishing.'], bullets: objectives.slice(0, 6) }],
  '/aim-scope/aim': [{ heading: 'Our aim', paragraphs: ['The aim of the International Journal Publishers Association (IJPAss) is to strengthen scholarly publishing by promoting excellence in academic journals, enhancing research visibility and impact, supporting ethical publishing practices, and providing reliable mechanisms for journal quality assessment, citation tracking, and international recognition.'] }],
  '/aim-scope/scope': [{ heading: 'Our scope', paragraphs: ['The International Journal Publishers Association (IJPAss) is committed to advancing the quality, visibility, credibility, and global impact of scholarly journals across all academic disciplines.', 'The Association serves as a professional platform for journal publishers, editors, reviewers, researchers, librarians, and academic institutions by promoting ethical publishing practices, rigorous peer review, digital publishing innovations, journal indexing, citation analysis, journal ranking systems, research integrity, and international collaboration.', 'IJPAss supports the development of sustainable, transparent, and globally recognized scholarly publishing standards.'] }],
  '/aim-scope/objectives': [{ heading: 'Strategic objectives', bullets: objectives }],
  '/role': [{ heading: 'A global professional body', paragraphs: ['IJPAss works with journal publishers, editors, reviewers, researchers, academic institutions, libraries, and research organizations to enhance the standards, visibility, and long-term impact of academic publications.'], bullets: ['Promote publishing excellence and research integrity.', 'Develop journal quality assessment, ranking, and citation analytics.', 'Enhance journal visibility, indexing readiness, and international dissemination.', 'Build professional capacity through training, certification, and knowledge exchange.', 'Advance digital innovation, open science, responsible open access, and global collaboration.', 'Provide recognition, policy advocacy, advisory services, and performance monitoring.'] }],
  '/role/publishing-excellence': [{ heading: 'Promoting publishing excellence', paragraphs: ['IJPAss establishes and encourages best practices in scholarly publishing, ensuring high standards of editorial quality, peer review, and publication ethics.'], bullets: ['Editorial quality and transparent policies', 'Rigorous and responsible peer review', 'Publication ethics and accountability', 'Continuous quality improvement'] }],
  '/role/research-integrity': [{ heading: 'Supporting research integrity', paragraphs: ['IJPAss promotes transparency, originality, responsible authorship, plagiarism prevention, conflict-of-interest disclosure, and adherence to internationally accepted publication ethics.'], bullets: ['Originality and plagiarism prevention', 'Responsible authorship and contributor disclosure', 'Conflict-of-interest transparency', 'Ethical editorial and review practices'] }],
  '/role/international-collaboration': [{ heading: 'Promoting international collaboration', paragraphs: ['IJPAss fosters partnerships among publishers, universities, research institutions, professional societies, libraries, funding agencies, and policymakers to strengthen global scholarly communication.'], bullets: ['Cross-border publishing partnerships', 'Institutional and library collaboration', 'Knowledge exchange and professional networks', 'Inclusive global scholarly communication'] }],
  '/role/digital-publishing': [{ heading: 'Supporting digital publishing innovation', paragraphs: ['IJPAss encourages modern publishing technologies, online editorial management systems, digital archiving, quality metadata, and interoperable publishing standards.'], bullets: ['Online editorial management workflows', 'Metadata quality and publishing standards', 'Digital preservation and archiving', 'Interoperable publishing platforms and research analytics'] }],
  '/role/open-access': [{ heading: 'Facilitating open science and open access', paragraphs: ['IJPAss encourages responsible open-access publishing, data sharing, reproducible research, and broader dissemination of scientific knowledge while supporting sustainable publishing models.'], bullets: ['Responsible open-access policies', 'Sustainable publishing models', 'Research data sharing and reproducibility', 'Wider and more equitable knowledge access'] }],
  '/journal-ranking': [{ heading: 'Journal quality assessment and ranking', paragraphs: ['IJPAss develops objective frameworks for evaluating and ranking scholarly journals based on editorial quality, peer-review practices, publication standards, research impact, citation performance, and ethical compliance.'] }],
  '/journal-ranking/methodology': [{ heading: 'Transparent evaluation', paragraphs: ['Journal assessment combines editorial quality, peer-review practices, publication standards, research impact, citation performance, discoverability, and ethical compliance. IJPAss is committed to objective frameworks and continuous quality improvement.'] }],
  '/journal-ranking/criteria': [{ heading: 'Core evaluation criteria', bullets: ['Editorial governance and policy transparency', 'Peer-review quality and integrity', 'Publication ethics and research integrity', 'Content quality and regularity', 'Citation performance and academic influence', 'Indexing, metadata, discoverability, and digital preservation'] }],
  '/journal-ranking/citations': [{ heading: 'Citation tracking and research analytics', paragraphs: ['IJPAss supports citation tracking systems and publication metrics that assess the academic influence, visibility, and impact of journals, articles, authors, and institutions.'], bullets: ['Citation counts and trends', 'Journal performance indicators', 'Article usage statistics', 'Research visibility and impact measures'] }]
};

export const membershipFees = [
  ['Student Member','Undergraduate, postgraduate, and research scholars','1 Year','15','1,000'],
  ['Individual Member','Researchers, authors, reviewers, academicians, librarians','1 Year','30','2,500'],
  ['Editor Member','Editors, Associate Editors, Editorial Board Members','1 Year','50','4,000'],
  ['Journal Member','Individual scholarly journal','1 Year','100','8,000'],
  ['Publisher Member','Publishing organizations managing multiple journals','1 Year','250','20,000'],
  ['Institutional Member','Universities, colleges, research institutions, libraries','1 Year','300','25,000'],
  ['Corporate Member','Companies supporting scholarly publishing','1 Year','500','40,000'],
  ['Life Member (Individual)','Individual professionals','Lifetime','300','25,000'],
  ['Honorary Member','Eminent scholars and distinguished contributors','Lifetime','By Invitation','No Fee'],
  ['Fellow (FIJPAss)','Senior professionals with outstanding contributions','5 Years / Renewable','200','15,000']
];

export const membershipBenefits = [
  ['Student Member',['Digital membership certificate','Discounted webinars and workshops','Networking with researchers and editors','Newsletters and publishing resources']],
  ['Individual Member',['All Student Member benefits','Voting rights, subject to the Association constitution','Eligibility to serve on committees','Discounts on conferences, training, and certification']],
  ['Editor Member',['All Individual Member benefits','Editorial best-practice resources','Training in peer review, ethics, and journal management','Recognition in the IJPAss Editor Directory']],
  ['Journal Member',['Journal quality assessment and advisory support','Eligibility for ranking and evaluation','Citation tracking and performance reports','IJPAss Journal Directory listing']],
  ['Publisher Member',['Benefits covering all journals under the organization','Indexing and international visibility support','Publisher profile in the IJPAss Directory','Publisher forums and policy discussions']],
  ['Institutional Member',['Institutional recognition','Faculty and researcher training','Institutional publishing support','Collaborative research and publishing initiatives']],
  ['Corporate Member',['Partnership, branding, and sponsorship opportunities','International publishing events','Industry reports and professional networking']],
  ['Life Member',['Lifetime certificate with no annual renewal fees','Permanent member benefits','Eligibility for leadership and advisory roles']],
  ['Honorary Member',['Recognition of distinguished scholars and leaders for exceptional contributions to scholarly publishing']],
  ['Fellow (FIJPAss)',['Use of the post-nominal FIJPAss','Fellowship certificate and recognition','Advisory committee and policy-development eligibility','Keynote and mentoring opportunities']]
] as [string,string[]][];

export const optionalServices = ['Journal Evaluation and Accreditation','Journal Ranking and Quality Assessment','Citation Tracking and Analytics Reports','Editorial Board Certification','Reviewer Certification','Editor Certification','Publication Ethics Audit','Journal Website Quality Audit','Indexing Readiness Assessment','Digital Preservation and Archiving Consultation'];
