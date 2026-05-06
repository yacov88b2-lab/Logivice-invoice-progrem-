import { useState, useEffect, useCallback } from 'react';
import { api } from "../../api";
import type { Pricelist } from '../../types';

interface PricelistListProps {
  onEdit: (pricelist: Pricelist) => void;
  onRefresh: () => void;
  refreshTrigger: number;
}

export function PricelistList({ onEdit, onRefresh, refreshTrigger }: PricelistListProps) {
  const [pricelists, setPricelists] = useState<Pricelist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const fetchPricelists = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getPricelists();
      setPricelists(data);
      setError(null);
    } catch (err) {
      setError('Failed to load pricelists');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPricelists();
  }, [fetchPricelists, refreshTrigger]);

  const handleDelete = async (id: number) => {
    try {
      setDeleting(id);
      await api.deletePricelist(id);
      onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete pricelist';
      alert(msg);
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = (id: number) => {
    window.open(api.downloadPricelist(id), '_blank');
  };

  if (loading) {
    return <div className="p-8 text-center text-sm text-slate-600">Loading pricelists...</div>;
  }

  if (error) {
    return (
      <div className="p-8 text-center text-sm text-red-600">
        {error}
        <button 
          onClick={fetchPricelists}
          className="ml-4 font-semibold text-[#28258b] hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (pricelists.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        <div className="text-base font-semibold text-slate-800">No pricelists yet</div>
        <div className="mt-1">Upload a customer template to start generating monthly invoices.</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded bg-white shadow-lg">
            <div className="p-6">
              <div className="text-base font-semibold text-slate-950">
                You are about to delete a customer price list; this action is permanent.
              </div>
              <div className="mt-2 text-sm text-slate-700">Are you sure you want to continue?</div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const id = confirmDeleteId;
                    setConfirmDeleteId(null);
                    await handleDelete(id);
                  }}
                  disabled={deleting === confirmDeleteId}
                  className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting === confirmDeleteId ? 'Deleting...' : 'Yes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-100 text-slate-700">
            <th className="p-4 text-left font-semibold">Name</th>
            <th className="p-4 text-left font-semibold">Customer</th>
            <th className="p-4 text-left font-semibold">Warehouse</th>
            <th className="p-4 text-left font-semibold">Sheets</th>
            <th className="p-4 text-left font-semibold">Created</th>
            <th className="p-4 text-left font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {pricelists.map((p) => (
            <tr key={p.id} className="border-b border-slate-200 hover:bg-slate-50">
              <td className="p-4 font-semibold text-slate-950">{p.name}</td>
              <td className="p-4">{p.customer_name}</td>
              <td className="p-4">
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{p.warehouse_code}</span>
              </td>
              <td className="p-4">
                {p.template_structure?.sheets?.length || 0} sheets
              </td>
              <td className="p-4 text-slate-600">
                {new Date(p.created_at).toLocaleDateString()}
              </td>
              <td className="p-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(p.id)}
                    className="rounded bg-[#28258b]/10 px-3 py-1 text-xs font-semibold text-[#28258b] hover:bg-[#28258b]/15"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => onEdit(p)}
                    className="rounded bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(p.id)}
                    disabled={deleting === p.id || confirmDeleteId !== null}
                    className="rounded bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50"
                  >
                    {deleting === p.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
