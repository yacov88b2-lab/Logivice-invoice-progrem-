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
  previewMapping: async (pricelistId: number, startDate: string, endDate: string, resolvedItems?: Record<string, number>) => {
    const body: Record<string, unknown> = { pricelist_id: pricelistId, start_date: startDate, end_date: endDate };
    if (resolvedItems && Object.keys(resolvedItems).length > 0) body.resolvedItems = resolvedItems;
    const res = await fetch(`${API_BASE}/generate/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to preview mapping'));
    return res.json();
  },

  generateInvoice: async (pricelistId: number, startDate: string, endDate: string, userId: number = 1, resolvedItems?: Record<string, number>, force = false, forceReview = false) => {
    const body: Record<string, unknown> = { pricelist_id: pricelistId, start_date: startDate, end_date: endDate, user_id: userId, force, force_review: forceReview };
    if (resolvedItems && Object.keys(resolvedItems).length > 0) body.resolvedItems = resolvedItems;
    const res = await fetch(`${API_BASE}/generate/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      const data = await res.json();
      const err = new Error(data.message || 'Duplicate invoice period') as any;
      err.isDuplicate = true;
      err.generatedAt = data.generatedAt;
      err.existingAuditLogId = data.existingAuditLogId;
      throw err;
    }
    if (res.status === 422) {
      const data = await res.json();
      if (data.error === 'unresolved_review_items') {
        const err = new Error(data.message) as any;
        err.isUnresolvedReview = true;
        err.unresolvedCount = data.count;
        throw err;
      }
      throw new Error(await getErrorMessage(res, 'Failed to generate invoice'));
    }
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

  // Customer rules
  getRules: async () => {
    const res = await fetch(`${API_BASE}/rules`);
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch rules'));
    return res.json();
  },

  createRule: async (rule: unknown) => {
    const res = await fetch(`${API_BASE}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create rule'));
    return res.json();
  },

  updateRule: async (id: string, rule: unknown) => {
    const res = await fetch(`${API_BASE}/rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to update rule'));
    return res.json();
  },

  toggleRule: async (id: string, enabled: boolean) => {
    const res = await fetch(`${API_BASE}/rules/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, updated_by: 'admin' }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to toggle rule'));
    return res.json();
  },

  createRuleVersion: async (id: string) => {
    const res = await fetch(`${API_BASE}/rules/${id}/create-version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ created_by: 'admin' }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create draft copy'));
    return res.json();
  },

  deleteRule: async (id: string) => {
    const res = await fetch(`${API_BASE}/rules/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updated_by: 'admin' }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to delete rule'));
  },

  testRule: async (id: string, testData: unknown) => {
    const res = await fetch(`${API_BASE}/rules/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testData }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to test rule'));
    return res.json();
  },

  markRuleTested: async (id: string) => {
    const res = await fetch(`${API_BASE}/rules/${id}/mark-tested`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tested_by: 'admin' }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to mark rule as tested'));
    return res.json();
  },

  approveRule: async (id: string) => {
    const res = await fetch(`${API_BASE}/rules/${id}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved_by: 'admin' }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to approve rule'));
    return res.json();
  },

  revertRuleToDraft: async (id: string) => {
    const res = await fetch(`${API_BASE}/rules/${id}/revert-to-draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reverted_by: 'admin' }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to revert rule to draft'));
    return res.json();
  },

  // Tableau URL validation — structural check + best-effort view lookup
  validateTableauUrl: async (url: string) => {
    const res = await fetch(`${API_BASE}/rules/validate-tableau-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return res.json() as Promise<{
      valid: boolean;
      urlParsed?: boolean;
      viewFound?: boolean | null;
      workbook?: string;
      view?: string;
      columns?: string[];
      sampleRows?: string[][];
      rowCount?: number;
      error?: string;
      warning?: string;
    }>;
  },

  // Rule Assistant
  suggestRuleSteps: async (customerId: string, description: string, sampleTransactions?: unknown[]) => {
    const res = await fetch(`${API_BASE}/rules/assistant/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: customerId, description, sample_transactions: sampleTransactions }),
    });
    if (!res.ok) {
      if (res.status === 503) throw new Error('503');
      throw new Error(await getErrorMessage(res, 'Rule assistant request failed'));
    }
    return res.json() as Promise<{ steps: unknown[]; explanation: string }>;
  },

  // Bug reports
  reportBug: async (report: { title: string; description: string; page?: string; severity?: string; reported_by?: string }) => {
    const res = await fetch(`${API_BASE}/bug-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to submit bug report'));
    return res.json();
  },

  // Health check
  health: async () => {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },
};
