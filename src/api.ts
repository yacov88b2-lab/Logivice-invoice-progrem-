export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// ── Token storage ─────────────────────────────────────────────────────────────

const TOKEN_KEY = 'logivice_token';

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = tokenStore.get();
  return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
}

// ── Error helpers ─────────────────────────────────────────────────────────────

const getErrorMessage = async (res: Response, fallback: string) => {
  try {
    const data = await res.json();
    if (data?.error) return String(data.error);
  } catch {
    // ignore
  }
  return fallback;
};

function handle401(res: Response): boolean {
  if (res.status === 401) {
    tokenStore.clear();
    window.dispatchEvent(new Event('logivice:logout'));
    return true;
  }
  return false;
}

export const api = {
  // Auth
  login: async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Login failed'));
    const data = await res.json();
    if (data.token) tokenStore.set(data.token);
    return data as { token?: string; requiresTwoFactor?: boolean; preToken?: string; user?: Record<string, unknown> };
  },

  verify2FA: async (preToken: string, code: string) => {
    const res = await fetch(`${API_BASE}/auth/2fa-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preToken, code }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, '2FA verification failed'));
    const data = await res.json();
    if (data.token) tokenStore.set(data.token);
    return data as { token: string; user: Record<string, unknown> };
  },

  getMe: async () => {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch profile'));
    return res.json();
  },

  logout: async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: authHeaders() });
    } finally {
      tokenStore.clear();
    }
  },

  // User management
  getUsers: async () => {
    const res = await fetch(`${API_BASE}/users`, { headers: authHeaders() });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch users'));
    return res.json();
  },

  createUser: async (data: { email: string; name?: string; role: string; password: string }) => {
    const res = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create user'));
    return res.json();
  },

  updateUser: async (id: string, data: { name?: string; role?: string }) => {
    const res = await fetch(`${API_BASE}/users/${id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to update user'));
    return res.json();
  },

  disableUser: async (id: string) => {
    const res = await fetch(`${API_BASE}/users/${id}/disable`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to disable user'));
    return res.json();
  },

  enableUser: async (id: string) => {
    const res = await fetch(`${API_BASE}/users/${id}/enable`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to enable user'));
    return res.json();
  },

  inviteUser: async (data: { email: string; name?: string; role: string }) => {
    const res = await fetch(`${API_BASE}/users/invite`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to send invite'));
    return res.json() as Promise<{ invite: Record<string, unknown>; inviteLink: string }>;
  },

  getInvites: async () => {
    const res = await fetch(`${API_BASE}/users/invites`, { headers: authHeaders() });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch invites'));
    return res.json();
  },

  revokeInvite: async (id: string) => {
    const res = await fetch(`${API_BASE}/users/invites/${id}/revoke`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to revoke invite'));
    return res.json();
  },

  resendInvite: async (id: string) => {
    const res = await fetch(`${API_BASE}/users/invites/${id}/resend`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to resend invite'));
    return res.json() as Promise<{ invite: Record<string, unknown>; inviteLink: string }>;
  },

  getInviteInfo: async (token: string) => {
    const res = await fetch(`${API_BASE}/auth/invite/${token}`);
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Invalid or expired invite link'));
    return res.json() as Promise<{ email: string; name: string | null; role: string; expires_at: string }>;
  },

  acceptInvite: async (token: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/invite/${token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create account'));
    return res.json() as Promise<{ ok: boolean; message: string }>;
  },

  resetUserPassword: async (id: string, newPassword: string) => {
    const res = await fetch(`${API_BASE}/users/${id}/reset-password`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ newPassword }),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to reset password'));
    return res.json();
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const res = await fetch(`${API_BASE}/users/change-password`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to change password'));
    return res.json();
  },

  // Security / 2FA
  get2FAStatus: async () => {
    const res = await fetch(`${API_BASE}/security/2fa/status`, { headers: authHeaders() });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch 2FA status'));
    return res.json() as Promise<{ enabled: boolean; backupCodesRemaining: number }>;
  },

  setup2FA: async () => {
    const res = await fetch(`${API_BASE}/security/2fa/setup`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to start 2FA setup'));
    return res.json() as Promise<{ secret: string; qrCodeDataUrl: string }>;
  },

  confirm2FA: async (code: string) => {
    const res = await fetch(`${API_BASE}/security/2fa/confirm`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code }),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to confirm 2FA'));
    return res.json() as Promise<{ backupCodes: string[] }>;
  },

  disable2FA: async (password: string) => {
    const res = await fetch(`${API_BASE}/security/2fa/disable`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password }),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to disable 2FA'));
    return res.json();
  },

  regenerateBackupCodes: async (password: string) => {
    const res = await fetch(`${API_BASE}/security/2fa/backup-codes/regenerate`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password }),
    });
    if (handle401(res)) throw new Error('Session expired');
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to regenerate backup codes'));
    return res.json() as Promise<{ backupCodes: string[] }>;
  },

  // Pricelists
  getPricelists: async () => {
    const res = await fetch(`${API_BASE}/pricelists`, { headers: authHeaders() });
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

  exportTotal: async (pricelistId: number, startDate: string, endDate: string, resolvedItems?: Record<string, number>) => {
    const body: Record<string, unknown> = { pricelist_id: pricelistId, start_date: startDate, end_date: endDate };
    if (resolvedItems && Object.keys(resolvedItems).length > 0) body.resolvedItems = resolvedItems;
    const res = await fetch(`${API_BASE}/generate/export-total`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
  validateTableauUrl: async (url: string): Promise<{
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
  }> => {
    const SERVER_ERROR = 'Could not validate Tableau URL. Check that the server is running and Tableau credentials are configured.';
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/rules/validate-tableau-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
    } catch {
      throw new Error(SERVER_ERROR);
    }
    if (!res.ok) {
      const msg = await getErrorMessage(res, SERVER_ERROR);
      throw new Error(msg);
    }
    try {
      return await res.json();
    } catch {
      throw new Error(SERVER_ERROR);
    }
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
  reportBug: async (report: {
    title: string;
    description: string;
    page?: string;
    severity?: string;
    reported_by?: string;
    context?: string;
    screenshot?: Blob;
  }) => {
    let body: BodyInit;
    let headers: Record<string, string> = {};

    if (report.screenshot) {
      const fd = new FormData();
      fd.append('title', report.title);
      fd.append('description', report.description);
      if (report.page) fd.append('page', report.page);
      if (report.severity) fd.append('severity', report.severity);
      if (report.reported_by) fd.append('reported_by', report.reported_by);
      if (report.context) fd.append('context', report.context);
      fd.append('screenshot', report.screenshot, 'screenshot.png');
      body = fd;
    } else {
      const { screenshot: _s, ...rest } = report;
      body = JSON.stringify(rest);
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${API_BASE}/bug-reports`, { method: 'POST', headers, body });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to submit bug report'));
    return res.json();
  },

  // Health check
  health: async () => {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },
};
