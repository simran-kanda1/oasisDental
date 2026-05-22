import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { BrowserRouter, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PatientProfileProvider } from './contexts/PatientProfileContext';
import { Sidebar, TopBar } from './components/layout/Sidebar';
import { AppLoadingSkeleton } from './components/ui/skeleton';
import { pathToSection, DEFAULT_AUTHENTICATED_PATH, DEFAULT_STAFF_PATH, sectionToPath } from './lib/routes';
import { registerAppNavigator, type AppSection } from './lib/navigation';
import { NO_APPT_BOOKED_QUEUE_ID } from './data/queueRules';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage'));
const FollowUpOutreachPage = lazy(() => import('./pages/FollowUpOutreachPage'));
const FrontDeskQueuesPage = lazy(() => import('./pages/FrontDeskQueuesPage'));
const InquiriesPage = lazy(() => import('./pages/InquiriesPage'));
const EstimatesPage = lazy(() => import('./pages/EstimatesPage'));
const AdminPortalPage = lazy(() => import('./pages/AdminPortalPage'));
const StaffTasksPage = lazy(() => import('./pages/StaffTasksPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const PageFallback = () => (
  <div className="p-4 space-y-4 max-w-full mx-auto">
    <div className="h-16 rounded-md bg-slate-200/80 animate-pulse" />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 rounded-md bg-slate-200/60 animate-pulse" />
      ))}
    </div>
    <div className="h-64 rounded-md bg-slate-200/50 animate-pulse" />
  </div>
);

const AppShell: React.FC = () => {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const { section, queueId } = useMemo(
    () => pathToSection(location.pathname),
    [location.pathname]
  );

  useEffect(() => {
    registerAppNavigator((path) => navigate(path));
  }, [navigate]);

  useEffect(() => {
    if (!user || loading) return;
    if (location.pathname === '/' || location.pathname === '') {
      navigate(isAdmin ? DEFAULT_AUTHENTICATED_PATH : DEFAULT_STAFF_PATH, { replace: true });
    }
  }, [user, loading, isAdmin, location.pathname, navigate]);

  useEffect(() => {
    if (!user || loading) return;
    if (section === 'admin' && !isAdmin) {
      navigate(DEFAULT_AUTHENTICATED_PATH, { replace: true });
    }
  }, [user, loading, section, isAdmin, navigate]);

  if (loading) {
    return <AppLoadingSkeleton />;
  }

  if (!user) {
    return (
      <Suspense fallback={<AppLoadingSkeleton />}>
        <LoginPage />
      </Suspense>
    );
  }

  const renderPage = () => {
    switch (section) {
      case 'dashboard':
        return <DashboardPage />;
      case 'staffTasks':
        return <StaffTasksPage />;
      case 'appointments':
        return <AppointmentsPage />;
      case 'followups':
      case 'frontDeskQueues':
        return (
          <FrontDeskQueuesPage
            initialQueueId={section === 'followups' ? NO_APPT_BOOKED_QUEUE_ID : queueId}
          />
        );
      case 'followUpOutreach':
        return <FollowUpOutreachPage initialTab="pred_follow_up" />;
      case 'inquiries':
        return <InquiriesPage />;
      case 'estimates':
        return <EstimatesPage />;
      case 'settings':
        return <SettingsPage />;
      case 'admin':
        return isAdmin ? <AdminPortalPage /> : <Navigate to={DEFAULT_AUTHENTICATED_PATH} replace />;
      default:
        return <DashboardPage />;
    }
  };

  const handleSectionChange = (id: string) => {
    if (id === 'admin' && !isAdmin) {
      navigate(DEFAULT_AUTHENTICATED_PATH);
      return;
    }
    navigate(sectionToPath(id as AppSection));
  };

  return (
    <PatientProfileProvider>
      <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900 selection:bg-teal-100 selection:text-teal-900">
        <Sidebar activeSection={section} onSectionChange={handleSectionChange} />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar section={section} />
          <main className="flex-1 overflow-auto bg-slate-50/50">
            <Suspense fallback={<PageFallback />}>{renderPage()}</Suspense>
          </main>
        </div>
      </div>
    </PatientProfileProvider>
  );
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
