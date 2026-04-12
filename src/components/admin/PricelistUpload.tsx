import { useState } from 'react';
import { api } from "../../api";
import type { Pricelist } from '../../types';

interface PricelistUploadProps {
  pricelist: Pricelist | null;
  onClose: () => void;
}

export function PricelistUpload({ pricelist, onClose }: PricelistUploadProps) {
  const [formData, setFormData] = useState({
    name: pricelist?.name || '',
    customer_name: pricelist?.customer_name || '',
    warehouse_code: pricelist?.warehouse_code || '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!pricelist;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.customer_name || !formData.warehouse_code) {
      setError('Please fill in all required fields');
      return;
    }

    if (!isEditing && !file) {
      setError('Please select a file to upload');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const data = new FormData();
      data.append('name', formData.name);
      data.append('customer_name', formData.customer_name);
      data.append('warehouse_code', formData.warehouse_code);
      
      if (file) {
        data.append('file', file);
      }

      if (isEditing && pricelist) {
        await api.updatePricelist(pricelist.id, data);
      } else {
        await api.createPricelist(data);
      }

      onClose();
    } catch (err) {
      setError('Failed to save pricelist. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">
        {isEditing ? 'Edit Pricelist' : 'Upload New Pricelist'}
      </h3>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Pricelist Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., AudioCodes CZ Warehouse"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer Name *
            </label>
            <input
              type="text"
              value={formData.customer_name}
              onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., AudioCodes"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Warehouse Code *
            </label>
            <input
              type="text"
              value={formData.warehouse_code}
              onChange={(e) => setFormData({ ...formData, warehouse_code: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., CZ"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Excel File {isEditing ? '(leave empty to keep current)' : '*'}
          </label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full px-3 py-2 border rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <p className="text-sm text-gray-500 mt-1">
            Upload an Excel file with invoice template structure
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : (isEditing ? 'Update Pricelist' : 'Upload Pricelist')}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
