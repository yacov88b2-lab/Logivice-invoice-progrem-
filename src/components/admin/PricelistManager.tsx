import { useState } from 'react';
import { PricelistList } from './PricelistList';
import { PricelistUpload } from './PricelistUpload';
import type { Pricelist } from '../../types';

export function PricelistManager() {
  const [showUpload, setShowUpload] = useState(false);
  const [editingPricelist, setEditingPricelist] = useState<Pricelist | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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
        <button
          onClick={() => setShowUpload(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Upload New Pricelist
        </button>
      </div>

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
