import { useState } from 'react';
import { PricelistManager } from './components/admin/PricelistManager';
import { UserDashboard } from './components/user/UserDashboard';

function App() {
  const [activeTab, setActiveTab] = useState<'user' | 'admin'>('user');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Logivice Invoice Processor
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Universal Excel processing for logistics billing
              </p>
            </div>
            <nav className="flex gap-2">
              <button
                onClick={() => setActiveTab('user')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                User Dashboard
              </button>
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'admin'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Admin
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'user' ? <UserDashboard /> : <PricelistManager />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-600">
          Logivice Invoice Processor © 2026
        </div>
      </footer>
    </div>
  );
}

export default App;
