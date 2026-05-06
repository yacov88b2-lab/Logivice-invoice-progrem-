import { useEffect, useMemo, useState } from 'react';
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
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [customers, setCustomers] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<string[]>([]);

  const isEditing = !!pricelist;

  const sortedCustomers = useMemo(() => {
    return Array.from(new Set(customers)).sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const sortedWarehouses = useMemo(() => {
    return Array.from(new Set(warehouses)).sort((a, b) => a.localeCompare(b));
  }, [warehouses]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setOptionsLoading(true);
        const data = await api.getTableauOptions();
        if (!mounted) return;
        const rawCustomers = data.customers || [];
        const normalizedCustomers = rawCustomers.map(c => {
          const v = String(c || '').trim();
          if (v === 'Afimilk') return 'Afimilk New Zealand';
          return v;
        });
        setCustomers(normalizedCustomers);
        setWarehouses(data.warehouses || []);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (!mounted) return;
        setError(err.message);
      } finally {
        if (mounted) setOptionsLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const customer = String(formData.customer_name || '').trim();
    if (!customer) return;

    // Temporary mapping (for now we work on Afimilk only). Later we will replace this
    // with a customer->warehouse mapping sourced from Tableau.
    const warehouseByCustomer: Record<string, string> = {
      Afimilk: 'NZ',
      'Afimilk New Zealand': 'NZ',
    };

    const wh = warehouseByCustomer[customer];
    if (wh && formData.warehouse_code !== wh) {
      setFormData(prev => ({ ...prev, warehouse_code: wh }));
    }
  }, [formData.customer_name, formData.warehouse_code]);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.customer_name || !formData.warehouse_code) {
      setError('Please fill in all required fields');
      return;
    }

    const customerTokens = String(formData.customer_name || '')
      .trim()
      .split(/[\s-]+/)
      .filter(Boolean)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const customerPattern = customerTokens.join('[\\s-]+');
    const nameRegex = new RegExp(`^${customerPattern}\\s*[–-]\\s*Template\\s+\\d{4}$`);
    if (!nameRegex.test(formData.name.trim())) {
      setError('Pricelist Name need to be in a format of “Customer name – Template YYYY”.');
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
    <div className="rounded border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 border-b border-slate-200 pb-4">
        <h3 className="text-lg font-semibold text-slate-950">
          {isEditing ? 'Edit Pricelist' : 'Upload Pricelist'}
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Keep customer, warehouse, and template naming consistent so invoice generation can auto-select the right file.
        </p>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Pricelist Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
            placeholder="e.g., Afimilk – Template 2026"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer Name *
            </label>
            <div className="flex gap-2">
              <select
                value={formData.customer_name}
                onChange={(e) => {
                  const customer = e.target.value;
                  setFormData(prev => ({ ...prev, customer_name: customer }));
                }}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
                disabled={optionsLoading || loading}
              >
                <option value="">Select customer...</option>
                {sortedCustomers.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const v = prompt('Add Customer Name');
                  const value = String(v || '').trim();
                  if (!value) return;
                  setCustomers(prev => (prev.includes(value) ? prev : [...prev, value]));
                  setFormData(prev => ({ ...prev, customer_name: value }));
                }}
                disabled={loading}
                className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Add
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Warehouse Code *
            </label>
            <div className="flex gap-2">
              <select
                value={formData.warehouse_code}
                onChange={(e) => setFormData({ ...formData, warehouse_code: e.target.value })}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
                disabled={optionsLoading || loading || ['Afimilk', 'Afimilk New Zealand'].includes(String(formData.customer_name || '').trim())}
              >
                <option value="">Select warehouse...</option>
                {sortedWarehouses.map(w => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const v = prompt('Add Warehouse Code');
                  const value = String(v || '').trim();
                  if (!value) return;
                  setWarehouses(prev => (prev.includes(value) ? prev : [...prev, value]));
                  setFormData(prev => ({ ...prev, warehouse_code: value }));
                }}
                disabled={loading}
                className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Add
              </button>
            </div>
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
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm file:mr-4 file:rounded file:border-0 file:bg-[#28258b]/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#28258b] hover:file:bg-[#28258b]/15"
          />
          <p className="text-sm text-gray-500 mt-1">
            Upload an Excel file with invoice template structure
          </p>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-[#28258b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Saving...' : (isEditing ? 'Update Pricelist' : 'Upload Pricelist')}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
