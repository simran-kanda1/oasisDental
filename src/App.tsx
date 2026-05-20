import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PatientProfileProvider } from './contexts/PatientProfileContext';
import { WixInquiriesBackgroundSync } from './components/WixInquiriesBackgroundSync';
import { Sidebar, TopBar } from './components/layout/Sidebar';
import { Tooth } from './components/ui/icons';
import { type AppSection, getNavigateEventName } from './lib/navigation';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage'));
const FollowUpsPage = lazy(() => import('./pages/FollowUpsPage'));
const FollowUpOutreachPage = lazy(() => import('./pages/FollowUpOutreachPage'));
const FrontDeskQueuesPage = lazy(() => import('./pages/FrontDeskQueuesPage'));
const InquiriesPage = lazy(() => import('./pages/InquiriesPage'));
const EstimatesPage = lazy(() => import('./pages/EstimatesPage'));
const EmailCampaignsPage = lazy(() => import('./pages/EmailCampaignsPage'));
const WeaveConnectPage = lazy(() => import('./pages/WeaveConnectPage'));
const AdminPortalPage = lazy(() => import('./pages/AdminPortalPage'));
const StaffTasksPage = lazy(() => import('./pages/StaffTasksPage'));

const AppShell: React.FC = () => {
  const { user, loading, isAdmin } = useAuth();
  const [activeSection, setActiveSection] = useState<AppSection>('dashboard');

  useEffect(() => {
    if (!user) return;
    if (!isAdmin) setActiveSection('staffTasks');
  }, [user, isAdmin]);

  useEffect(() => {
    const eventName = getNavigateEventName();
    const handler = (event: Event) => {
      const section = (event as CustomEvent<AppSection>).detail;
      if (!section) return;
      if (section === 'admin' && !isAdmin) {
        setActiveSection('dashboard');
        return;
      }
      setActiveSection(section);
    };
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }, [isAdmin]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] left-[-20%] w-[150%] h-[150%] bg-gradient-to-br from-teal-50/20 via-white to-blue-50/10 blur-3xl opacity-50" />
        </div>
        <div className="text-center space-y-8 relative z-10">
          <div className="w-16 h-16 rounded bg-teal-600 flex items-center justify-center mx-auto shadow-2xl shadow-teal-500/20 animate-pulse">
            <Tooth className="text-white" size={32} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Oasis Dental</h1>
            <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] opacity-60">Syncing Registry...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={null}>
        <LoginPage />
      </Suspense>
    );
  }

  const renderPage = () => {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardPage />;
      case 'staffTasks':
        return <StaffTasksPage />;
      case 'appointments':
        return <AppointmentsPage />;
      case 'followups':
        return <FollowUpsPage />;
      case 'followUpOutreach':
        return <FollowUpOutreachPage initialTab="follow_up" />;
      case 'frontDeskQueues':
        return <FrontDeskQueuesPage />;
      case 'inquiries':
        return <InquiriesPage />;
      case 'estimates':
        return <EstimatesPage />;
      case 'newsletter':
        return <EmailCampaignsPage />;
      case 'weave':
        return <WeaveConnectPage />;
      case 'admin':
        return isAdmin ? <AdminPortalPage /> : <DashboardPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <PatientProfileProvider>
      <WixInquiriesBackgroundSync />
      <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900 selection:bg-teal-100 selection:text-teal-900">
        <Sidebar
          activeSection={activeSection}
          onSectionChange={(s) => {
            if (s === 'admin' && !isAdmin) {
              setActiveSection('dashboard');
              return;
            }
            setActiveSection(s as AppSection);
          }}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar section={activeSection} />
          <main className="flex-1 overflow-auto bg-slate-50/50">
            <Suspense
              fallback={
                <div className="h-full min-h-[200px] flex items-center justify-center text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                  Loading workspace...
                </div>
              }
            >
              {renderPage()}
            </Suspense>
          </main>
        </div>
      </div>
    </PatientProfileProvider>
  );
};

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

export default App;
