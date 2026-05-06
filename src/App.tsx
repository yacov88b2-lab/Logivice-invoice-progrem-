import { useState } from 'react';
import { PricelistManager } from './components/admin/PricelistManager';
import { CustomerRules } from './components/admin/CustomerRules';
import { UserDashboard } from './components/user/UserDashboard';
import { BugReportButton } from './components/BugReportButton';
import { ToastContainer } from './components/ToastContainer';

function App() {
  const [activeTab, setActiveTab] = useState<'user' | 'rules' | 'admin'>('user');

  const tabs = [
    { id: 'user' as const, label: 'Monthly Invoice' },
    { id: 'rules' as const, label: 'Customer Rules' },
    { id: 'admin' as const, label: 'Admin' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <img
                src="/unilog-sc-logo.svg"
                alt="Unilog SC"
                className="h-[46px] w-auto shrink-0"
              />
              <div>
                <h1 className="text-xl font-semibold tracking-normal text-slate-950">
                  Monthly Invoice Control
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Create customer invoices correctly against the active pricelist.
                </p>
              </div>
            </div>
            <nav className="flex w-full flex-wrap gap-2 rounded-md border border-slate-200 bg-slate-50 p-1">
              {tabs.map(tab => (
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
        {activeTab === 'user' && <UserDashboard />}
        {activeTab === 'rules' && <CustomerRules />}
        {activeTab === 'admin' && <PricelistManager />}
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

export default App;
