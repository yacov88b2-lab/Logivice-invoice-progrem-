import { useState, useEffect } from 'react';
import { PricelistList } from './PricelistList';
import { PricelistUpload } from './PricelistUpload';
import type { Pricelist } from '../../types';
import { API_BASE } from '../../api';

export function PricelistManager() {
  const [showUpload, setShowUpload] = useState(false);
  const [editingPricelist, setEditingPricelist] = useState<Pricelist | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Deploy state
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

  // Check deploy status on mount
  useEffect(() => {
    checkDeployStatus();
  }, []);

  const checkDeployStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/deploy/status`);
      const data = await response.json();
      setDeployStatus(prev => ({
        ...prev,
        canDeploy: data.canDeploy,
        commitsBehind: data.commitsBehind,
        pendingCommits: data.pendingCommits || []
      }));
    } catch (error) {
      console.error('Failed to check deploy status:', error);
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
        alert('✅ Deployed successfully!\n\nTest-Main has been merged to main and pushed to GitHub.\nProduction site will update automatically.');
      } else {
        setDeployStatus(prev => ({
          ...prev,
          loading: false,
          lastDeployResult: 'error: ' + data.error
        }));
        alert('❌ Deploy failed:\n' + data.error);
      }
    } catch (error) {
      setDeployStatus(prev => ({
        ...prev,
        loading: false,
        lastDeployResult: 'error: ' + (error as Error).message
      }));
      alert('❌ Deploy failed:\n' + (error as Error).message);
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Pricelist Management</h2>
          <p className="text-gray-600 mt-1">
            Upload and manage customer pricelist templates
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Deploy Button */}
          {deployStatus.canDeploy && (
            <button
              onClick={handleDeploy}
              disabled={deployStatus.loading}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
                  🚀 Deploy to Production
                  <span className="bg-green-800 px-2 py-0.5 rounded text-xs">
                    {deployStatus.commitsBehind} commit{deployStatus.commitsBehind !== 1 ? 's' : ''}
                  </span>
                </>
              )}
            </button>
          )}
          <button
            onClick={() => setShowUpload(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Upload New Pricelist
          </button>
        </div>
      </div>

      {/* Deploy Status Banner */}
      {deployStatus.lastDeployResult && deployStatus.lastDeployResult.startsWith('success') && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
          ✅ <strong>Successfully deployed to production!</strong> Test-Main changes are now in main.
        </div>
      )}
      {deployStatus.lastDeployResult && deployStatus.lastDeployResult.startsWith('error') && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          ❌ <strong>Deploy failed:</strong> {deployStatus.lastDeployResult.replace('error: ', '')}
        </div>
      )}

      {showUpload ? (
        <PricelistUpload 
          pricelist={editingPricelist} 
          onClose={handleCloseUpload} 
        />
      ) : (
        <div className="bg-white rounded-lg shadow">
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
