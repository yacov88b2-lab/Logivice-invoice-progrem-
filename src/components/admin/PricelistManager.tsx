import { useState, useEffect } from 'react';
import { PricelistList } from './PricelistList';
import { PricelistUpload } from './PricelistUpload';
import type { Pricelist } from '../../types';
import { API_BASE } from '../../api';

export function PricelistManager() {
  const [showUpload, setShowUpload] = useState(false);
  const [editingPricelist, setEditingPricelist] = useState<Pricelist | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [deployStatus, setDeployStatus] = useState<{
    loading: boolean;
    canDeploy: boolean;
    commitsBehind: number;
    pendingCommits: string[];
    lastDeployResult: string | null;
  }>({
    loading: false,
    canDeploy: false,
    commitsBehind: 0,
    pendingCommits: [],
    lastDeployResult: null
  });

  useEffect(() => {
    checkDeployStatus();
  }, []);

  const checkDeployStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/deploy/status`);
      if (!response.ok) {
        setDeployStatus(prev => ({
          ...prev,
          canDeploy: false,
          commitsBehind: 0,
          pendingCommits: []
        }));
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setDeployStatus(prev => ({
          ...prev,
          canDeploy: false,
          commitsBehind: 0,
          pendingCommits: []
        }));
        return;
      }

      const data = await response.json();
      setDeployStatus(prev => ({
        ...prev,
        canDeploy: Boolean(data?.canDeploy),
        commitsBehind: Number(data?.commitsBehind || 0),
        pendingCommits: data.pendingCommits || []
      }));
    } catch {
      setDeployStatus(prev => ({
        ...prev,
        canDeploy: false,
        commitsBehind: 0,
        pendingCommits: []
      }));
    }
  };

  const handleDeploy = async () => {
    if (!confirm('Deploy Test-Main to Production (main)?\n\nThis will merge all Test-Main changes to main and push to GitHub.')) {
      return;
    }

    setDeployStatus(prev => ({ ...prev, loading: true, lastDeployResult: null }));

    try {
      const response = await fetch(`${API_BASE}/deploy/deploy-to-production`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (data.success) {
        setDeployStatus(prev => ({
          ...prev,
          loading: false,
          lastDeployResult: 'success',
          canDeploy: false,
          commitsBehind: 0,
          pendingCommits: []
        }));
        alert('Deployed successfully!\n\nTest-Main has been merged to main and pushed to GitHub.\nProduction site will update automatically.');
      } else {
        setDeployStatus(prev => ({
          ...prev,
          loading: false,
          lastDeployResult: 'error: ' + data.error
        }));
        alert('Deploy failed:\n' + data.error);
      }
    } catch (error) {
      setDeployStatus(prev => ({
        ...prev,
        loading: false,
        lastDeployResult: 'error: ' + (error as Error).message
      }));
      alert('Deploy failed:\n' + (error as Error).message);
    }
  };

  const handleEdit = (pricelist: Pricelist) => {
    setEditingPricelist(pricelist);
    setShowUpload(true);
  };

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleCloseUpload = () => {
    setShowUpload(false);
    setEditingPricelist(null);
    handleRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#58a967]">
            Template Library
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Pricelists</h2>
          <p className="mt-2 text-sm text-slate-600">
            Upload and manage the Excel templates used for customer monthly invoices.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {deployStatus.canDeploy && (
            <button
              onClick={handleDeploy}
              disabled={deployStatus.loading}
              className="flex items-center gap-2 rounded bg-[#58a967] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#43864f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deployStatus.loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Deploying...
                </>
              ) : (
                <>
                  Deploy to Production
                  <span className="rounded bg-green-800 px-2 py-0.5 text-xs">
                    {deployStatus.commitsBehind} commit{deployStatus.commitsBehind !== 1 ? 's' : ''}
                  </span>
                </>
              )}
            </button>
          )}
          <button
            onClick={() => setShowUpload(true)}
            className="rounded bg-[#28258b] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f1d70]"
          >
            Upload Pricelist
          </button>
        </div>
      </div>

      {deployStatus.lastDeployResult && deployStatus.lastDeployResult.startsWith('success') && (
        <div className="rounded border border-green-200 bg-green-50 p-4 text-green-800">
          <strong>Successfully deployed to production!</strong> Test-Main changes are now in main.
        </div>
      )}
      {deployStatus.lastDeployResult && deployStatus.lastDeployResult.startsWith('error') && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-red-800">
          <strong>Deploy failed:</strong> {deployStatus.lastDeployResult.replace('error: ', '')}
        </div>
      )}

      {showUpload ? (
        <PricelistUpload
          pricelist={editingPricelist}
          onClose={handleCloseUpload}
        />
      ) : (
        <div className="rounded border border-slate-200 bg-white shadow-sm">
          <PricelistList
            onEdit={handleEdit}
            onRefresh={handleRefresh}
            refreshTrigger={refreshTrigger}
          />
        </div>
      )}
    </div>
  );
}
