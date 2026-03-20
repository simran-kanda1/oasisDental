import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar, TopBar } from './components/layout/Sidebar';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AppointmentsPage from './pages/AppointmentsPage';
import FollowUpsPage from './pages/FollowUpsPage';
import InquiriesPage from './pages/InquiriesPage';
import EstimatesPage from './pages/EstimatesPage';
import EmailCampaignsPage from './pages/EmailCampaignsPage';
import WeaveConnectPage from './pages/WeaveConnectPage';
import AdminPortalPage from './pages/AdminPortalPage';
import StaffTasksPage from './pages/StaffTasksPage';
import { Tooth } from './components/ui/icons';

type Section = 'dashboard' | 'appointments' | 'followups' | 'inquiries' | 'estimates' | 'newsletter' | 'weave' | 'admin' | 'staffTasks';

const AppShell: React.FC = () => {
  const { user, loading } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('dashboard');

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
    return <LoginPage />;
  }

  const renderPage = () => {
    switch (activeSection) {
      case 'dashboard': return <DashboardPage />;
      case 'staffTasks': return <StaffTasksPage />;
      case 'appointments': return <AppointmentsPage />;
      case 'followups': return <FollowUpsPage />;
      case 'inquiries': return <InquiriesPage />;
      case 'estimates': return <EstimatesPage />;
      case 'newsletter': return <EmailCampaignsPage />;
      case 'weave': return <WeaveConnectPage />;
      case 'admin': return <AdminPortalPage />;
      default: return <DashboardPage />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900 selection:bg-teal-100 selection:text-teal-900">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={(s) => setActiveSection(s as Section)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar section={activeSection} />
        <main className="flex-1 overflow-auto bg-slate-50/50">
          {renderPage()}
        </main>
      </div>
    </div>
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
