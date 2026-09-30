import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SkeletonRows } from './components/ui';
import { useAuth } from './lib/auth';
import { Login } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Applications = lazy(() => import('./pages/Applications'));
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail'));
const Jobs = lazy(() => import('./pages/Jobs'));
const JobDetail = lazy(() => import('./pages/JobDetail'));
const Interviews = lazy(() => import('./pages/Interviews'));
const FollowUps = lazy(() => import('./pages/FollowUps'));
const Companies = lazy(() => import('./pages/Companies'));
const CompanyDetail = lazy(() => import('./pages/CompanyDetail'));
const Contacts = lazy(() => import('./pages/Contacts'));
const Resumes = lazy(() => import('./pages/Resumes'));
const Documents = lazy(() => import('./pages/Documents'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Import = lazy(() => import('./pages/Import'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

export function App() {
  const { status } = useAuth();
  if (!status) {
    return (
      <div style={{ padding: 40 }}>
        <SkeletonRows rows={3} />
      </div>
    );
  }
  if (!status.authenticated) return <Login status={status} />;
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="applications" element={<Applications />} />
          <Route path="applications/:id" element={<ApplicationDetail />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="interviews" element={<Interviews />} />
          <Route path="follow-ups" element={<FollowUps />} />
          <Route path="companies" element={<Companies />} />
          <Route path="companies/:id" element={<CompanyDetail />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="resumes" element={<Resumes />} />
          <Route path="documents" element={<Documents />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="import" element={<Import />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
