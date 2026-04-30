export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const getErrorMessage = async (res: Response, fallback: string) => {
  try {
    const data = await res.json();
    if (data?.details) return String(data.details);
    if (data?.error) return String(data.error);
  } catch {
    // ignore
  }
  return fallback;
};

export const api = {
  // Pricelists
  getPricelists: async () => {
    const res = await fetch(`${API_BASE}/pricelists`);
    if (!res.ok) throw new Error('Failed to fetch pricelists');
    return res.json();
  },

  getPricelist: async (id: number) => {
    const res = await fetch(`${API_BASE}/pricelists/${id}`);
    if (!res.ok) throw new Error('Failed to fetch pricelist');
    return res.json();
  },

  createPricelist: async (formData: FormData) => {
    const res = await fetch(`${API_BASE}/pricelists`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to create pricelist');
    return res.json();
  },

  updatePricelist: async (id: number, formData: FormData) => {
    const res = await fetch(`${API_BASE}/pricelists/${id}`, {
      method: 'PUT',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to update pricelist');
    return res.json();
  },

  deletePricelist: async (id: number) => {
    const res = await fetch(`${API_BASE}/pricelists/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      let msg = 'Failed to delete pricelist';
      try {
        const data = await res.json();
        if (data?.error) msg = String(data.error);
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
  },

  downloadPricelist: (id: number) => {
    return `${API_BASE}/pricelists/${id}/download`;
  },

  getTableauOptions: async () => {
    const res = await fetch(`${API_BASE}/tableau/options`);
    if (!res.ok) {
      let msg = 'Failed to fetch Tableau options';
      try {
        const data = await res.json();
        if (data?.error) msg = String(data.error);
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    return res.json() as Promise<{ customers: string[]; warehouses: string[] }>;
  },

  // Generation
  previewMapping: async (pricelistId: number, startDate: string, endDate: string) => {
    const res = await fetch(`${API_BASE}/generate/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pricelist_id: pricelistId, start_date: startDate, end_date: endDate }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to preview mapping'));
    return res.json();
  },

  generateInvoice: async (pricelistId: number, startDate: string, endDate: string, userId: number = 1) => {
    const res = await fetch(`${API_BASE}/generate/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        pricelist_id: pricelistId, 
        start_date: startDate, 
        end_date: endDate,
        user_id: userId 
      }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to generate invoice'));
    const data = await res.json();
    if (!data?.success) {
      throw new Error(String(data?.error || 'Failed to generate invoice'));
    }
    return data;
  },

  exportTotal: async (pricelistId: number, startDate: string, endDate: string) => {
    const res = await fetch(`${API_BASE}/generate/export-total`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pricelist_id: pricelistId, start_date: startDate, end_date: endDate }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to export total. Please try again.'));
    return res;
  },

  downloadInvoice: (auditLogId: number) => {
    return `${API_BASE}/generate/download/${auditLogId}`;
  },

  // Health check
  health: async () => {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },
};
