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
    return <div className="p-8 text-center">Loading pricelists...</div>;
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        {error}
        <button 
          onClick={fetchPricelists}
          className="ml-4 text-blue-600 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (pricelists.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No pricelists found. Upload one to get started.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-lg">
            <div className="p-6">
              <div className="text-base font-semibold text-gray-900">
<<<<<<< Updated upstream
                You are about to permanently delete a customer price list.
              </div>
              <div className="mt-2 text-base font-semibold text-gray-900">This action cannot be undone.</div>
=======
                You are about to delete a customer price list; this action is permanent.
              </div>
              <div className="mt-2 text-sm text-gray-700">Are you sure you want to continue?</div>
>>>>>>> Stashed changes
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
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
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting === confirmDeleteId ? 'Deleting...' : 'Yes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-100 border-b">
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
            <tr key={p.id} className="border-b hover:bg-gray-50">
              <td className="p-4 font-medium">{p.name}</td>
              <td className="p-4">{p.customer_name}</td>
              <td className="p-4">{p.warehouse_code}</td>
              <td className="p-4">
                {p.template_structure?.sheets?.length || 0} sheets
              </td>
              <td className="p-4 text-sm text-gray-600">
                {new Date(p.created_at).toLocaleDateString()}
              </td>
              <td className="p-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(p.id)}
                    className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => onEdit(p)}
                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(p.id)}
                    disabled={deleting === p.id || confirmDeleteId !== null}
                    className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
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
