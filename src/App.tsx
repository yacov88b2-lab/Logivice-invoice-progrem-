import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PricelistManager } from './components/admin/PricelistManager';
import { CustomerRules } from './components/admin/CustomerRules';
import { UserDashboard } from './components/user/UserDashboard';
import { UserManagement } from './components/admin/UserManagement';
import { SecuritySettings } from './components/user/SecuritySettings';
import { LoginPage } from './components/auth/LoginPage';
import { InviteAcceptPage } from './components/auth/InviteAcceptPage';
import { BugReportButton } from './components/BugReportButton';
import { ToastContainer } from './components/ToastContainer';

type TabId = 'user' | 'rules' | 'admin' | 'users' | 'security';

function AppShell() {
  const { user, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('user');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#eef5ff] text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const isAdmin = ['super_admin', 'admin'].includes(user.role);

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: 'user',     label: 'Monthly Invoice',  show: true },
    { id: 'rules',    label: 'Customer Rules',   show: true },
    { id: 'admin',    label: 'Admin',             show: isAdmin },
    { id: 'users',    label: 'Users',             show: isAdmin },
    { id: 'security', label: 'Security',          show: true },
  ];

  return (
    <div className="min-h-screen bg-[#eef5ff] text-slate-900 font-sans">
      <header
        className="sticky top-0 z-40 shadow-lg"
        style={{ background: 'linear-gradient(135deg, #0c1d4e 0%, #1e3a8a 60%, #1d62a8 100%)' }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Unilog SC" className="h-9 w-auto shrink-0 brightness-0 invert" />
              <div>
                <h1 className="text-white text-lg font-bold tracking-tight leading-tight">
                  Monthly Invoice Control
                </h1>
                <p className="text-white/60 text-xs leading-tight hidden sm:block">
                  Unilog SC · Invoice Processor
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-white/75 text-sm hidden sm:block">{user.name || user.email}</span>
              <span className="bg-white/15 text-white/90 text-xs px-2.5 py-1 rounded-full font-medium">
                {user.role.replace('_', ' ')}
              </span>
              <button
                onClick={() => logout()}
                className="text-white/75 hover:text-white text-xs border border-white/25 hover:border-white/50 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-all"
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="pb-2">
            <nav className="flex gap-0.5 bg-black/20 backdrop-blur-sm rounded-xl p-1 w-fit">
              {tabs.filter(t => t.show).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                    activeTab === tab.id
                      ? 'bg-white text-[#1e3a8a] shadow-sm font-semibold'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {activeTab === 'user'     && <UserDashboard />}
        {activeTab === 'rules'    && <CustomerRules />}
        {activeTab === 'admin'    && isAdmin && <PricelistManager />}
        {activeTab === 'users'    && isAdmin && <UserManagement />}
        {activeTab === 'security' && <SecuritySettings />}
      </main>

      <ToastContainer />
      <BugReportButton />

      <footer className="mt-10 border-t border-slate-200/50">
        <div className="mx-auto max-w-7xl px-4 py-3 text-center text-xs text-slate-400 sm:px-6">
          Unilog SC Invoice Control · 2026
        </div>
      </footer>
    </div>
  );
}

function App() {
  if (window.location.pathname === '/register/accept') {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    return <InviteAcceptPage token={token} />;
  }
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

export default App;
