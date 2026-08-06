import { lazy, Suspense } from 'react';
import { Navigate, Routes, Route, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import { navigation } from './data/navigation';

const Home = lazy(() => import('./pages/Home'));
const ContentPage = lazy(() => import('./pages/ContentPage'));
const FormPage = lazy(() => import('./pages/FormPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const PortalDashboard = lazy(() => import('./pages/PortalDashboard'));
const ProtectedRoute = lazy(() => import('./components/ProtectedRoute'));
const MembersListPage = lazy(() => import('./pages/MembersListPage'));
const MemberProfilePage = lazy(() => import('./pages/MemberProfilePage'));
const MembershipApplicationPage = lazy(() => import('./pages/MembershipApplicationPage'));
const JournalIndexPage = lazy(() => import('./pages/JournalIndexPage'));
const IndexedJournalPage = lazy(() => import('./pages/IndexedJournalPage'));
const IndexedArticlePage = lazy(() => import('./pages/IndexedArticlePage'));
const CitedByPage = lazy(() => import('./pages/CitedByPage'));
const IndexingDatabasePage = lazy(() => import('./pages/IndexingDatabasePage'));
const IndexedAuthorProfilePage = lazy(() => import('./pages/IndexedAuthorProfilePage'));

const formRoutes: Record<string, string> = {
  '/contact': 'Contact us', '/about/contact': 'Contact us', '/membership/apply': 'Apply for membership',
  '/membership/renew': 'Renew membership', '/journal-ranking/submit': 'Submit your journal'
};

function PageLoader() {
  return <div className="route-loader" role="status"><span className="spinner-border"/><span>Loading…</span></div>;
}

function LegacyResourceRedirect() {
  const { sourceId = '' } = useParams();
  return <Navigate to={`/indexing-db/resources/${sourceId}`} replace/>;
}

export default function App() {
  const routes = navigation.flatMap(item => [item.path, ...(item.children?.map(child => child.path) || [])]).filter(path => path !== '/');
  return <Suspense fallback={<PageLoader/>}><Routes>
    <Route element={<ProtectedRoute roles={['SUPER_ADMIN', 'INTERNAL_USER']}/>}>
      <Route path="/admin/internal_user/:userId/*" element={<PortalDashboard/>}/>
      <Route path="/admin" element={<Navigate to="/admin/dashboard" replace/>}/>
      <Route path="/admin/dashboard" element={<PortalDashboard/>}/>
      <Route path="/admin/internal-users" element={<PortalDashboard/>}/>
      <Route path="/admin/internal-users/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/publishers" element={<PortalDashboard/>}/>
      <Route path="/admin/publishers/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/journal-publishers" element={<PortalDashboard/>}/>
      <Route path="/admin/journal-publishers/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/sources" element={<PortalDashboard/>}/>
      <Route path="/admin/sources/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/manuscripts" element={<PortalDashboard/>}/>
      <Route path="/admin/manuscripts/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/author-profiles" element={<PortalDashboard/>}/>
      <Route path="/admin/author-profiles/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/author-merge-requests" element={<PortalDashboard/>}/>
      <Route path="/admin/author-merge-requests/:id" element={<PortalDashboard/>}/>
      <Route path="/admin/affiliation-merge-requests" element={<PortalDashboard/>}/>
      <Route path="/admin/affiliation-merge-requests/:id" element={<PortalDashboard/>}/>
      <Route path="/admin/affiliation-profiles" element={<PortalDashboard/>}/>
      <Route path="/admin/affiliation-profiles/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/subject-areas" element={<PortalDashboard/>}/>
      <Route path="/admin/subject-areas/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/major-subjects" element={<PortalDashboard/>}/>
      <Route path="/admin/major-subjects/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/classification-names" element={<PortalDashboard/>}/>
      <Route path="/admin/classification-names/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/journals" element={<Navigate to="/admin/dashboard" replace/>}/>
      <Route path="/admin/journals/addnew" element={<Navigate to="/admin/dashboard" replace/>}/>
      <Route path="/admin/membership-categories" element={<PortalDashboard/>}/>
      <Route path="/admin/membership-categories/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/members" element={<PortalDashboard/>}/>
      <Route path="/admin/members/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/ranking-citations" element={<PortalDashboard/>}/>
      <Route path="/admin/ranking-citations/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/contact-enquiries" element={<PortalDashboard/>}/>
      <Route path="/admin/membership-applications" element={<PortalDashboard/>}/>
      <Route path="/admin/settings" element={<PortalDashboard/>}/>
      <Route path="/admin/settings/addnew" element={<PortalDashboard/>}/>
    </Route>
    <Route element={<ProtectedRoute roles={['PUBLISHER']}/>}><Route path="/publisher" element={<PortalDashboard publisher/>}/></Route>
    <Route element={<Layout/>}>
      <Route index element={<Home/>}/>
      <Route path="/admin/login" element={<LoginPage portal="staff"/>}/>
      <Route path="/login/publishers" element={<LoginPage portal="publishers"/>}/>
      <Route path="/membership/members" element={<MembersListPage/>}/>
      <Route path="/membership/members/:memberName" element={<MemberProfilePage/>}/>
      <Route path="/membership/apply" element={<MembershipApplicationPage/>}/>
      <Route path="/indexing-db" element={<Navigate to="/indexing-db/resources" replace/>}/>
      <Route path="/indexing-db/resources" element={<IndexingDatabasePage kind="resources"/>}/>
      <Route path="/indexing-db/resources/:sourceId" element={<IndexedJournalPage/>}/>
      <Route path="/indexing-db/authors" element={<IndexingDatabasePage kind="authors"/>}/>
      <Route path="/indexing-db/authors/:authorId" element={<IndexedAuthorProfilePage/>}/>
      <Route path="/indexing-db/affiliations" element={<IndexingDatabasePage kind="affiliations"/>}/>
      <Route path="/indexing-db/countries" element={<IndexingDatabasePage kind="countries"/>}/>
      <Route path="/journal-ranking/index" element={<JournalIndexPage/>}/>
      <Route path="/journal-ranking/index/:sourceId" element={<LegacyResourceRedirect/>}/>
      <Route path="/journal-ranking/index/:sourceId/:manuscriptId" element={<IndexedArticlePage/>}/>
      <Route path="/journal-ranking/index/:sourceId/:manuscriptId/citedby" element={<CitedByPage/>}/>
      {routes.filter(path => !['/membership/members', '/membership/apply', '/journal-ranking/index', '/indexing-db', '/indexing-db/resources', '/indexing-db/authors', '/indexing-db/affiliations', '/indexing-db/countries'].includes(path)).map(path => <Route key={path} path={path} element={formRoutes[path] ? <FormPage kind={formRoutes[path]}/> : <ContentPage/>}/>) }
      <Route path="*" element={<ContentPage/>}/>
    </Route>
  </Routes></Suspense>;
}
