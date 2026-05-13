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
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">
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
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex items-center gap-4">
                <img src="/logo.png" alt="Unilog SC" className="h-[46px] w-auto shrink-0" />
                <div>
                  <h1 className="text-xl font-semibold tracking-normal text-slate-950">
                    Monthly Invoice Control
                  </h1>
                  <p className="mt-1 text-sm text-slate-600">
                    Create customer invoices correctly against the active pricelist.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-slate-500">{user.name || user.email}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{user.role}</span>
                <button
                  onClick={() => logout()}
                  className="rounded border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Sign out
                </button>
              </div>
            </div>
            <nav className="flex w-full flex-wrap gap-2 rounded-md border border-slate-200 bg-slate-50 p-1">
              {tabs.filter(t => t.show).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded px-4 py-2 text-sm font-semibold transition-colors ${
                    activeTab === tab.id
                      ? 'bg-[#28258b] text-white shadow-sm'
                      : 'text-slate-700 hover:bg-white hover:text-slate-950'
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

      <footer className="mt-10 border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 text-center text-sm text-slate-500 sm:px-6">
          Unilog SC Invoice Control (c) 2026
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
