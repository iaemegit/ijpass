import { lazy, Suspense } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
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

const formRoutes: Record<string, string> = {
  '/contact': 'Contact us', '/about/contact': 'Contact us', '/membership/apply': 'Apply for membership',
  '/membership/renew': 'Renew membership', '/journal-ranking/submit': 'Submit your journal'
};

function PageLoader() {
  return <div className="route-loader" role="status"><span className="spinner-border"/><span>Loading…</span></div>;
}

export default function App() {
  const routes = navigation.flatMap(item => [item.path, ...(item.children?.map(child => child.path) || [])]).filter(path => path !== '/');
  return <Suspense fallback={<PageLoader/>}><Routes>
    <Route element={<ProtectedRoute roles={['SUPER_ADMIN', 'INTERNAL_USER']}/>}>
      <Route path="/admin" element={<Navigate to="/admin/dashboard" replace/>}/>
      <Route path="/admin/dashboard" element={<PortalDashboard/>}/>
      <Route path="/admin/internal-users" element={<PortalDashboard/>}/>
      <Route path="/admin/internal-users/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/publishers" element={<PortalDashboard/>}/>
      <Route path="/admin/publishers/addnew" element={<PortalDashboard/>}/>
      <Route path="/admin/journals" element={<PortalDashboard/>}/>
      <Route path="/admin/journals/addnew" element={<PortalDashboard/>}/>
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
      {routes.filter(path => path !== '/membership/members' && path !== '/membership/apply').map(path => <Route key={path} path={path} element={formRoutes[path] ? <FormPage kind={formRoutes[path]}/> : <ContentPage/>}/>) }
      <Route path="*" element={<ContentPage/>}/>
    </Route>
  </Routes></Suspense>;
}
