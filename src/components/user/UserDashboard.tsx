import { useState, useEffect, useMemo } from 'react';
import { api, tokenStore } from '../../api';
import type { Pricelist, PreviewResponse, GenerateResponse, RuleDiagnostic, TableauCopyResult, RegionPreviewResponse, RegionGenerateResponse } from '../../types';

export function UserDashboard() {
  const [pricelists, setPricelists] = useState<Pricelist[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('');
  const [selectedPricelist, setSelectedPricelist] = useState<number | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPricelists, setLoadingPricelists] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'select' | 'preview' | 'result'>('select');
  const [billingCycle, setBillingCycle] = useState<'custom' | 'full_month'>('full_month');
  const [duplicateWarning, setDuplicateWarning] = useState<{ generatedAt: string; existingAuditLogId: number } | null>(null);
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);

  // Region mode state
  const [mode, setMode] = useState<'warehouse' | 'region'>('warehouse');
  const [regionCustomer, setRegionCustomer] = useState<string>('');
  const [regionPreview, setRegionPreview] = useState<RegionPreviewResponse | null>(null);
  const [regionResult, setRegionResult] = useState<RegionGenerateResponse | null>(null);

  const loadPricelists = async () => {
    setLoadingPricelists(true);
    setError(null);

    try {
      const data = await api.getPricelists();
      setPricelists(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load pricelists';
      setError(message);
    } finally {
      setLoadingPricelists(false);
    }
  };

  useEffect(() => {
    loadPricelists();
  }, []);

  // Auto-set dates when billing cycle changes
  useEffect(() => {
    const today = new Date();
    const firstDayOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastDayOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    
    if (billingCycle === 'full_month') {
      const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      setStartDate(formatDate(firstDayOfPrevMonth));
      setEndDate(formatDate(lastDayOfPrevMonth));
    }
  }, [billingCycle]);

  // Get unique customers from pricelists
  const customers = useMemo(
    () => Array.from(new Set(pricelists.map(p => p.customer_name))).sort(),
    [pricelists]
  );

  // Get warehouses filtered by selected customer
  const warehouses = useMemo(
    () => selectedCustomer
      ? Array.from(new Set(pricelists
          .filter(p => p.customer_name === selectedCustomer)
          .map(p => p.warehouse_code)
        )).sort()
      : [],
    [pricelists, selectedCustomer]
  );

  // Get pricelists filtered by customer and warehouse
  const filteredPricelists = useMemo(
    () => pricelists.filter(p =>
      (!selectedCustomer || p.customer_name === selectedCustomer) &&
      (!selectedWarehouse || p.warehouse_code === selectedWarehouse)
    ),
    [pricelists, selectedCustomer, selectedWarehouse]
  );

  const selectedPricelistRecord = useMemo(
    () => pricelists.find(p => p.id === selectedPricelist),
    [pricelists, selectedPricelist]
  );

  const regionWarehouses = useMemo(
    () => regionCustomer
      ? Array.from(new Set(
          pricelists
            .filter(p => p.customer_name === regionCustomer)
            .map(p => p.warehouse_code)
        )).sort()
      : [],
    [pricelists, regionCustomer]
  );

  const previewMatchRate = useMemo(
    () => {
      if (!preview) return 0;
      return Math.round((preview.summary.matched / Math.max(1, preview.summary.totalTransactions)) * 100);
    },
    [preview]
  );

  const readyToPreview = useMemo(
    () => Boolean(selectedCustomer && selectedWarehouse && selectedPricelist && startDate && endDate),
    [selectedCustomer, selectedWarehouse, selectedPricelist, startDate, endDate]
  );

  const previewRuleIssues = useMemo(
    () => preview?.ruleDiagnostics?.filter(d => !d.success || d.errors.length > 0 || d.warnings.length > 0).length || 0,
    [preview]
  );

  const resultRuleIssues = useMemo(
    () => result?.ruleDiagnostics?.filter(d => !d.success || d.errors.length > 0 || d.warnings.length > 0).length || 0,
    [result]
  );

  const previewDiagnosticsForReview = useMemo(
    () => preview?.ruleDiagnostics?.filter(d => !d.success || d.errors.length > 0 || d.warnings.length > 0).slice(0, 8) || [],
    [preview]
  );

  const resultDiagnosticsForReview = useMemo(
    () => result?.ruleDiagnostics?.filter(d => !d.success || d.errors.length > 0 || d.warnings.length > 0).slice(0, 8) || [],
    [result]
  );

  // Auto-select pricelist when only one option exists
  useEffect(() => {
    if (filteredPricelists.length === 1 && !selectedPricelist) {
      setSelectedPricelist(filteredPricelists[0].id);
    }
  }, [filteredPricelists, selectedPricelist]);

  // Auto-select customer and warehouse when only one option exists
  useEffect(() => {
    if (customers.length === 1 && !selectedCustomer) {
      setSelectedCustomer(customers[0]);
    }
  }, [customers, selectedCustomer]);

  useEffect(() => {
    if (warehouses.length === 1 && selectedCustomer && !selectedWarehouse) {
      setSelectedWarehouse(warehouses[0]);
    }
  }, [warehouses, selectedCustomer, selectedWarehouse]);

  // Clear stale preview and result data when user changes selection or billing cycle
  useEffect(() => {
    setPreview(null);
    setResult(null);
    setRegionPreview(null);
    setRegionResult(null);
    setStep('select');
    setError(null);
    setDuplicateWarning(null);
    setConfirmedDuplicate(false);
  }, [selectedCustomer, selectedWarehouse, selectedPricelist, startDate, endDate, billingCycle]);

  const handlePreview = async () => {
    if (!selectedPricelist || !startDate || !endDate) {
      setError('Please select a pricelist and date range');
      return;
    }
    
    await executePreview();
  };

  const executePreview = async (withResolutions?: Record<string, number>) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.previewMapping(Number(selectedPricelist), startDate, endDate, withResolutions);
      setPreview(data);
      setStep('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to preview mapping. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedPricelist || !startDate || !endDate) {
      setError('Please select a pricelist and date range before generating the invoice.');
      return;
    }

    await executeGenerate(confirmedDuplicate);
  };

  const executeGenerate = async (force: boolean) => {
    try {
      setLoading(true);
      setError(null);
      setDuplicateWarning(null);
      const data = await api.generateInvoice(Number(selectedPricelist), startDate, endDate, {}, force, true);
      setResult(data);
      setStep('result');
      setConfirmedDuplicate(false);
    } catch (err) {
      if ((err as any).isDuplicate) {
        setDuplicateWarning({ generatedAt: (err as any).generatedAt, existingAuditLogId: (err as any).existingAuditLogId });
      } else {
        setError(err instanceof Error ? err.message : 'Failed to generate invoice. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const downloadBlob = async (blob: Blob, filename: string) => {
    const urlObject = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = urlObject;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(urlObject);
  };

  const downloadFromResponse = async (response: Response, filename: string) => {
    if (!response.ok) {
      throw new Error('Failed to download file');
    }
    const blob = await response.blob();
    await downloadBlob(blob, filename);
  };

  const downloadFromUrl = async (url: string, filename: string) => {
    const token = tokenStore.get();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(url, { headers });
    await downloadFromResponse(res, filename);
  };

  const handleDownload = () => {
    if (!result?.auditLogId) return;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const pad2 = (n: number) => String(n).padStart(2, '0');
        const now = new Date();
        const localStamp = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()} ${pad2(now.getHours())}-${pad2(now.getMinutes())}`;

        const filename = (() => {
          const suggested = String((result as { suggestedFilename?: string })?.suggestedFilename || '').trim();
          if (suggested) return suggested;

          const customer = String(result?.pricelist?.customer || selectedCustomer || 'Customer').trim();
          const mm = result?.billingPeriod?.mm;
          const yyyy = result?.billingPeriod?.yyyy;
          const period = mm && yyyy ? `${mm}-${yyyy}` : '';
          const periodPart = period ? ` ${period}` : '';

          return `${customer}${periodPart} ${localStamp}.xlsx`;
        })();

        await downloadFromUrl(api.downloadInvoice(result.auditLogId), filename);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  };

  const handleReset = () => {
    setStep('select');
    setPreview(null);
    setResult(null);
    setError(null);
    setDuplicateWarning(null);
    setConfirmedDuplicate(false);
    setRegionPreview(null);
    setRegionResult(null);
  };

  const handleSwitchMode = (newMode: 'warehouse' | 'region') => {
    setMode(newMode);
    setStep('select');
    setPreview(null);
    setResult(null);
    setRegionPreview(null);
    setRegionResult(null);
    setError(null);
    setDuplicateWarning(null);
    setConfirmedDuplicate(false);
    setRegionCustomer('');
  };

  const handleRegionPreview = async () => {
    if (!regionCustomer || !startDate || !endDate) {
      setError('Please select a customer and billing period');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.previewRegionMapping(regionCustomer, startDate, endDate);
      setRegionPreview(data);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview region mapping');
    } finally {
      setLoading(false);
    }
  };

  const handleRegionGenerate = async () => {
    if (!regionCustomer || !startDate || !endDate) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.generateRegionInvoice(regionCustomer, startDate, endDate);
      setRegionResult(data);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate region invoice');
    } finally {
      setLoading(false);
    }
  };

  const handleRegionDownload = () => {
    if (!regionResult?.auditLogId) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const now = new Date();
        const stamp = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()} ${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
        const filename = `${regionCustomer} Combined ${stamp}.xlsx`;
        await downloadFromUrl(api.downloadInvoice(regionResult.auditLogId), filename);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Download failed');
      } finally {
        setLoading(false);
      }
    })();
  };

  const handleBackToPreview = () => {
    if (preview) {
      setStep('preview');
    }
  };

  const handleDownloadTotal = () => {
    if (!preview || !selectedPricelist || !startDate || !endDate) return;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const pad2 = (n: number) => String(n).padStart(2, '0');
        const now = new Date();
        const timestamp = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()} ${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
        const safeCustomer = String(selectedCustomer || preview?.pricelist?.name || 'Customer').trim();
        const downloadName = `${safeCustomer} Total transaction matched and unmatched ${timestamp}.xlsx`;

        const res = await api.exportTotal(Number(selectedPricelist), startDate, endDate, {});
        await downloadFromResponse(res, downloadName);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-5 shadow-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#58a967]">
              Billing Workspace
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
              Create Monthly Invoice
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Select the customer, confirm the active pricelist, review Tableau matches, and generate the final Excel invoice.
            </p>
          </div>
          <div className="flex gap-0.5 bg-black/5 rounded-xl p-1 text-center text-xs font-semibold min-w-[300px] sm:min-w-[360px]">
            <div className={`flex-1 rounded-lg px-3 py-2 transition-all ${step === 'select' ? 'text-white shadow-sm' : 'text-slate-500'}`}
              style={step === 'select' ? { background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' } : {}}>
              1. Setup
            </div>
            <div className={`flex-1 rounded-lg px-3 py-2 transition-all ${step === 'preview' ? 'text-white shadow-sm' : 'text-slate-500'}`}
              style={step === 'preview' ? { background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' } : {}}>
              2. Review
            </div>
            <div className={`flex-1 rounded-lg px-3 py-2 transition-all ${step === 'result' ? 'text-white shadow-sm' : 'text-slate-500'}`}
              style={step === 'result' ? { background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' } : {}}>
              3. Download
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-0.5 bg-black/5 rounded-xl p-1 text-xs font-semibold max-w-sm">
          <button
            type="button"
            onClick={() => handleSwitchMode('warehouse')}
            className={`flex-1 rounded-lg px-3 py-2 transition-all ${mode === 'warehouse' ? 'bg-white text-[#1e3a8a] shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
          >
            By Warehouse
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode('region')}
            className={`flex-1 rounded-lg px-3 py-2 transition-all ${mode === 'region' ? 'bg-white text-[#1e3a8a] shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
          >
            By Region — All Warehouses
          </button>
        </div>
      </section>

      {step === 'select' && mode === 'warehouse' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-2xl bg-white p-5 shadow-md">
            <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-950">Invoice Setup</h3>
                <p className="mt-1 text-sm text-slate-600">Use the current monthly period unless a customer needs a custom range.</p>
              </div>
              <span className="rounded bg-[#e9f6ec] px-3 py-1 text-xs font-semibold text-[#28753a]">
                Tableau source
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  Customer
                </span>
                <select
                  value={selectedCustomer}
                  onChange={(e) => {
                    setSelectedCustomer(e.target.value);
                    setSelectedWarehouse('');
                    setSelectedPricelist('');
                  }}
                  disabled={loadingPricelists}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">Choose a customer</option>
                  {customers.map(customer => (
                    <option key={customer} value={customer}>
                      {customer}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  Warehouse
                </span>
                <select
                  value={selectedWarehouse}
                  onChange={(e) => {
                    setSelectedWarehouse(e.target.value);
                    setSelectedPricelist('');
                  }}
                  disabled={!selectedCustomer || loadingPricelists}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
                >
                  <option value="">Choose a warehouse</option>
                  {warehouses.map(warehouse => (
                    <option key={warehouse} value={warehouse}>
                      {warehouse}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                Active Pricelist
              </span>
              <select
                value={selectedPricelist}
                onChange={(e) => setSelectedPricelist(e.target.value ? Number(e.target.value) : '')}
                disabled={!selectedCustomer || !selectedWarehouse || loadingPricelists}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
              >
                <option value="">Choose a pricelist</option>
                {filteredPricelists.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {loadingPricelists && (
              <div className="mt-4 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Loading pricelist options...
              </div>
            )}
            {!loadingPricelists && !error && pricelists.length === 0 && (
              <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No active pricelists are available. Please upload or enable a pricelist first.
              </div>
            )}
            {selectedCustomer && selectedWarehouse && filteredPricelists.length === 0 && (
              <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                No pricelist found for this customer and warehouse.
              </p>
            )}

            <div className="mt-5 border-t border-slate-200 pt-5">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                Billing Period
              </span>
              <div className="grid grid-cols-2 gap-0.5 rounded-xl bg-black/5 p-1">
                <button
                  type="button"
                  onClick={() => setBillingCycle('full_month')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                    billingCycle === 'full_month'
                      ? 'bg-white text-[#1e3a8a] shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Full Month
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle('custom')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                    billingCycle === 'custom'
                      ? 'bg-white text-[#1e3a8a] shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Custom Range
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  Start Date
                </span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={billingCycle === 'full_month'}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  End Date
                </span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={billingCycle === 'full_month'}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
                />
              </label>
            </div>
            {billingCycle === 'custom' && (
              <p className="mt-2 text-xs text-slate-500">
                For a quick first check, use a short range (a few days). Full-month runs query Tableau and may take 30–60 seconds.
              </p>
            )}

            {loadingPricelists && (
              <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                Loading available pricelists...
              </div>
            )}
            {error && (
              <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <div>{error}</div>
                <button
                  type="button"
                  onClick={loadPricelists}
                  disabled={loadingPricelists}
                  className="mt-3 inline-flex items-center rounded bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Retry loading pricelists
                </button>
              </div>
            )}

            <button
              onClick={handlePreview}
              disabled={loading || loadingPricelists || !readyToPreview}
              className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]"
              style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' }}
            >
              {loading ? 'Loading Preview…' : 'Preview Invoice Match'}
            </button>
          </section>

          <aside className="rounded-2xl bg-white shadow-md overflow-hidden">
            <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' }}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Configuration</p>
              <h3 className="mt-0.5 text-base font-semibold text-white">Selection Summary</h3>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: 'Customer', value: selectedCustomer },
                { label: 'Warehouse', value: selectedWarehouse },
                { label: 'Pricelist', value: selectedPricelistRecord?.name ?? '' },
                { label: 'Billing dates', value: startDate && endDate ? `${new Date(startDate).toLocaleDateString()} → ${new Date(endDate).toLocaleDateString()}` : '' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${value ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                    {value ? '✓' : '·'}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className={`text-sm font-semibold truncate ${value ? 'text-slate-900' : 'text-slate-400'}`}>{value || 'Not selected'}</div>
                  </div>
                </div>
              ))}
              <div className="mt-2 rounded-xl bg-[#eef5ff] p-3 text-xs text-slate-600 leading-relaxed">
                Preview checks Tableau transaction matches before generating the Excel invoice.
              </div>
            </div>
          </aside>
        </div>
      )}

      {step === 'select' && mode === 'region' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-2xl bg-white p-5 shadow-md">
            <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-950">Region Invoice Setup</h3>
                <p className="mt-1 text-sm text-slate-600">Select a customer to generate a combined invoice for all their warehouses at once.</p>
              </div>
              <span className="rounded bg-[#e9f6ec] px-3 py-1 text-xs font-semibold text-[#28753a]">All Warehouses</span>
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Customer</span>
              <select
                value={regionCustomer}
                onChange={(e) => setRegionCustomer(e.target.value)}
                disabled={loadingPricelists}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20 disabled:bg-slate-100 disabled:text-slate-400"
              >
                <option value="">Choose a customer</option>
                {customers.map(customer => (
                  <option key={customer} value={customer}>{customer}</option>
                ))}
              </select>
            </label>

            {regionCustomer && regionWarehouses.length > 0 && (
              <div className="mt-3 rounded-xl border border-[#1e3a8a]/15 bg-[#eef5ff] px-4 py-3 text-sm text-[#1e3a8a]">
                <span className="font-semibold">{regionWarehouses.length} warehouses</span> will be included in this invoice.
              </div>
            )}

            <div className="mt-5 border-t border-slate-200 pt-5">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Billing Period</span>
              <div className="grid grid-cols-2 gap-0.5 rounded-xl bg-black/5 p-1">
                <button
                  type="button"
                  onClick={() => setBillingCycle('full_month')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${billingCycle === 'full_month' ? 'bg-white text-[#1e3a8a] shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  Full Month
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle('custom')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${billingCycle === 'custom' ? 'bg-white text-[#1e3a8a] shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  Custom Range
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Start Date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={billingCycle === 'full_month'}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">End Date</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={billingCycle === 'full_month'}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
                />
              </label>
            </div>

            {error && (
              <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}

            <button
              onClick={handleRegionPreview}
              disabled={loading || loadingPricelists || !regionCustomer || !startDate || !endDate}
              className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]"
              style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' }}
            >
              {loading ? 'Loading Preview…' : 'Preview Region Invoice'}
            </button>
          </section>

          <aside className="rounded-2xl bg-white shadow-md overflow-hidden">
            <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' }}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Region Mode</p>
              <h3 className="mt-0.5 text-base font-semibold text-white">Warehouse Coverage</h3>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${regionCustomer ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {regionCustomer ? '✓' : '·'}
                </span>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Customer</div>
                  <div className={`text-sm font-semibold truncate ${regionCustomer ? 'text-slate-900' : 'text-slate-400'}`}>{regionCustomer || 'Not selected'}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${startDate && endDate ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {startDate && endDate ? '✓' : '·'}
                </span>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Billing dates</div>
                  <div className={`text-sm font-semibold truncate ${startDate && endDate ? 'text-slate-900' : 'text-slate-400'}`}>
                    {startDate && endDate ? `${new Date(startDate).toLocaleDateString()} → ${new Date(endDate).toLocaleDateString()}` : 'Not set'}
                  </div>
                </div>
              </div>
              {regionWarehouses.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Warehouses ({regionWarehouses.length})</div>
                  <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                    {regionWarehouses.map(wh => (
                      <div key={wh} className="flex items-center gap-2 rounded-lg bg-[#eef5ff] px-3 py-1.5 text-sm font-medium text-[#1e3a8a]">
                        <span className="text-[#58a967] font-bold">·</span>
                        {wh}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-2 rounded-xl bg-[#eef5ff] p-3 text-xs text-slate-600 leading-relaxed">
                  Select a customer to see which warehouses will be included in the combined invoice.
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {mode === 'warehouse' && step === 'preview' && preview && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-white p-5 shadow-md flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0369a1]">Step 2 of 3</p>
              <h3 className="mt-0.5 text-xl font-semibold text-slate-950">Review Match Quality</h3>
              <p className="mt-0.5 text-sm text-slate-500">{preview.pricelist.name}</p>
            </div>
            <button
              onClick={handleReset}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              ← Back
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #0c1a3a 0%, #1e3a8a 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{preview.summary.totalTransactions}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Total Transactions</div>
              <div className="mt-3 h-1 rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white/60" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #064e3b 0%, #10b981 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{preview.summary.matched}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Matched</div>
              <div className="mt-3 h-1 rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white/60" style={{ width: `${previewMatchRate}%` }} />
              </div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #7c2d12 0%, #f59e0b 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{preview.summary.unmatched}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Needs Review</div>
              <div className="mt-3 h-1 rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white/60" style={{ width: `${preview.summary.totalTransactions ? Math.round((preview.summary.unmatched / preview.summary.totalTransactions) * 100) : 0}%` }} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-md">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Match Rate</span>
              <span className="text-2xl font-bold" style={{ background: 'linear-gradient(135deg, #1e3a8a, #0369a1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{previewMatchRate}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${previewMatchRate}%`, background: 'linear-gradient(90deg, #1e3a8a 0%, #0369a1 50%, #58a967 100%)' }}
              />
            </div>
            <div className="mt-3 flex gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />Matched: {preview.summary.matched}</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-amber-400" />Unmatched: {preview.summary.unmatched}</span>
            </div>
          </div>

          <div className={`rounded border p-4 text-sm ${
            preview.activeRule
              ? 'border-[#1e3a8a]/20 bg-[#1e3a8a]/10 text-[#1e3a8a]'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}>
            <div className="font-semibold">
              {preview.activeRule
                ? `Active rule: ${preview.activeRule.name} v${preview.activeRule.version}`
                : 'No active database rule for this customer'}
            </div>
            <div className="mt-1">
              {preview.activeRule
                ? `${preview.activeRule.stepCount} steps tested against ${preview.ruleDiagnostics?.length || 0} transactions. ${previewRuleIssues} need rule review.`
                : 'Preview is using the legacy mapper only. QA can create and enable a draft rule from Rule Control.'}
            </div>
          </div>

          {preview.activeRule && (
            <RuleDiagnosticsPanel
              diagnostics={previewDiagnosticsForReview}
              totalIssues={previewRuleIssues}
              emptyMessage="No rule execution issues found in preview diagnostics."
            />
          )}

          {preview.summary.totalTransactions === 0 && (
            <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No transactions were found for this date range. Please confirm the selected customer, warehouse, and dates.
            </div>
          )}

          {duplicateWarning && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                An invoice for this period was already generated
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Generated on {new Date(duplicateWarning.generatedAt).toLocaleString()}. Generating again will create a second invoice for the same period.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setConfirmedDuplicate(true); executeGenerate(true); }}
                  disabled={loading}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Generate anyway
                </button>
                <button
                  type="button"
                  onClick={() => { setDuplicateWarning(null); setConfirmedDuplicate(false); }}
                  className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all hover:shadow-lg active:scale-[0.99] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #064e3b 0%, #10b981 100%)' }}
            >
              {loading ? 'Generating…' : '⚡ Generate Invoice'}
            </button>
            <button
              type="button"
              onClick={handleDownloadTotal}
              disabled={loading}
              className="rounded-xl border border-[#1e3a8a]/20 bg-[#1e3a8a]/8 px-4 py-3 text-sm font-semibold text-[#1e3a8a] hover:bg-[#1e3a8a]/15 disabled:opacity-50 transition-colors"
            >
              Download Total
            </button>
            <button
              onClick={handleReset}
              disabled={loading}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'region' && step === 'preview' && regionPreview && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-white p-5 shadow-md flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0369a1]">Step 2 of 3 — Region</p>
              <h3 className="mt-0.5 text-xl font-semibold text-slate-950">Review Region Match Quality</h3>
              <p className="mt-0.5 text-sm text-slate-500">{regionPreview.customerName} — {regionPreview.pricelistCount} warehouse{regionPreview.pricelistCount !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={handleReset} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              ← Back
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #0c1a3a 0%, #1e3a8a 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{regionPreview.summary.totalTransactions}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Total Transactions</div>
              <div className="mt-3 h-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/60" style={{ width: '100%' }} /></div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #064e3b 0%, #10b981 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{regionPreview.summary.matched}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Matched</div>
              <div className="mt-3 h-1 rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white/60" style={{ width: `${regionPreview.summary.totalTransactions ? Math.round((regionPreview.summary.matched / regionPreview.summary.totalTransactions) * 100) : 0}%` }} />
              </div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #7c2d12 0%, #f59e0b 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{regionPreview.summary.unmatched}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Needs Review</div>
              <div className="mt-3 h-1 rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white/60" style={{ width: `${regionPreview.summary.totalTransactions ? Math.round((regionPreview.summary.unmatched / regionPreview.summary.totalTransactions) * 100) : 0}%` }} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-md">
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Per-Warehouse Breakdown</h4>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr style={{ background: 'linear-gradient(90deg, #f8f7ff 0%, #eef5ff 100%)' }}>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Warehouse</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Pricelist</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Transactions</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Matched</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Unmatched</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {regionPreview.warehouseBreakdown.map((item, i) => (
                    <tr key={i} className={`border-t border-slate-100 hover:bg-[#f8f7ff] transition-colors ${i % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}`}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{item.warehouse}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{item.pricelistName}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{item.total}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-600">{item.matched}</td>
                      <td className="px-4 py-3 text-right text-amber-600">{item.unmatched}</td>
                      <td className="px-4 py-3 text-right">
                        {item.error ? (
                          <span className="text-xs text-red-600">Error</span>
                        ) : (
                          <span className={`text-xs font-semibold ${item.total > 0 && (item.matched / item.total) >= 0.8 ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {item.total > 0 ? `${Math.round((item.matched / item.total) * 100)}%` : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={handleRegionGenerate}
              disabled={loading}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all hover:shadow-lg active:scale-[0.99] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #064e3b 0%, #10b981 100%)' }}
            >
              {loading ? 'Generating…' : '⚡ Generate Region Invoice'}
            </button>
            <button
              onClick={handleReset}
              disabled={loading}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'warehouse' && step === 'result' && result && (
        <div className="space-y-5">
          <div className="rounded-2xl p-5 shadow-md text-white flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #0c1d4e 0%, #1e3a8a 60%, #1d62a8 100%)' }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Step 3 of 3</p>
              <h3 className="mt-0.5 text-xl font-semibold text-white">Invoice Generated Successfully</h3>
              <p className="mt-0.5 text-sm text-white/70">Download the final invoice or export the full transaction review.</p>
            </div>
            <button
              onClick={handleReset}
              className="rounded-lg border border-white/30 px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/15 transition-colors"
            >
              Start New
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #0c1a3a 0%, #1e3a8a 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{result.summary.totalTransactions}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Transactions</div>
              <div className="mt-3 h-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/60" style={{ width: '100%' }} /></div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #064e3b 0%, #10b981 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{result.summary.matched}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Matched</div>
              <div className="mt-3 h-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/60" style={{ width: `${result.summary.totalTransactions ? Math.round((result.summary.matched / result.summary.totalTransactions) * 100) : 0}%` }} /></div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #7c2d12 0%, #f59e0b 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{result.summary.unmatched}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Unmatched</div>
              <div className="mt-3 h-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/60" style={{ width: `${result.summary.totalTransactions ? Math.round((result.summary.unmatched / result.summary.totalTransactions) * 100) : 0}%` }} /></div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #0c4a6e 0%, #0284c7 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{result.summary.filledRows}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Rows Filled</div>
              <div className="mt-3 h-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/60" style={{ width: '100%' }} /></div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-md space-y-4">

          <div className={`rounded border p-4 text-sm ${
            result.activeRule
              ? 'border-[#1e3a8a]/20 bg-[#1e3a8a]/10 text-[#1e3a8a]'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}>
            <div className="font-semibold">
              {result.activeRule
                ? `Rule diagnostics: ${result.activeRule.name} v${result.activeRule.version}`
                : 'Generated with no active database rule diagnostics'}
            </div>
            <div className="mt-1">
              {result.activeRule
                ? `${result.ruleDiagnostics?.length || 0} transactions checked. ${resultRuleIssues} need QA review.`
                : 'Invoice generation still used the legacy mapper/customer handler path.'}
            </div>
          </div>

          {result.activeRule && (
            <RuleDiagnosticsPanel
              diagnostics={resultDiagnosticsForReview}
              totalIssues={resultRuleIssues}
              emptyMessage="No rule execution issues found in generation diagnostics."
            />
          )}

          {result.filledRows.length > 0 && (
            <div>
              <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Filled Rows</h4>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr style={{ background: 'linear-gradient(90deg, #f8f7ff 0%, #eef5ff 100%)' }}>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Sheet</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Row</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Old QTY</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">New QTY</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Old Total</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">New Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.filledRows.slice(0, 10).map((row, i) => (
                      <tr key={i} className={`border-t border-slate-100 hover:bg-[#f8f7ff] transition-colors ${i % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}`}>
                        <td className="px-4 py-3 font-medium text-slate-700">{row.sheet}</td>
                        <td className="px-4 py-3 text-slate-500">{row.row}</td>
                        <td className="px-4 py-3 text-right text-slate-400">{row.oldQty ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-600">{row.newQty}</td>
                        <td className="px-4 py-3 text-right text-slate-400">{row.oldTotal.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.newTotal.toFixed(2)}</td>
                      </tr>
                    ))}
                    {result.filledRows.length > 10 && (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td colSpan={6} className="px-4 py-3 text-center text-xs text-slate-400">
                          +{result.filledRows.length - 10} more rows in the downloaded file
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-4">
              <h4 className="font-semibold text-red-800 mb-2">Errors</h4>
              <ul className="text-sm text-red-700">
                {result.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          {result.tableauCopyResults && result.tableauCopyResults.length > 0 && (
            <TableauCopiedSheetsPanel results={result.tableauCopyResults} />
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleBackToPreview}
              disabled={loading || !preview}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              ← Back to Review
            </button>
            <button
              type="button"
              onClick={handleDownloadTotal}
              disabled={loading}
              className="flex-1 rounded-xl border border-[#1e3a8a]/20 bg-[#1e3a8a]/8 px-4 py-3 text-sm font-semibold text-[#1e3a8a] hover:bg-[#1e3a8a]/15 disabled:opacity-50 transition-colors"
            >
              Download Total
            </button>
            <button
              onClick={handleDownload}
              disabled={loading}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 transition-all hover:shadow-lg active:scale-[0.99]"
              style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' }}
            >
              {loading ? 'Downloading…' : '⬇ Download Invoice Excel'}
            </button>
          </div>
        </div>
      </div>
      )}

      {mode === 'region' && step === 'result' && regionResult && (
        <div className="space-y-5">
          <div className="rounded-2xl p-5 shadow-md text-white flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #0c1d4e 0%, #1e3a8a 60%, #1d62a8 100%)' }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Step 3 of 3 — Region Invoice</p>
              <h3 className="mt-0.5 text-xl font-semibold text-white">Combined Invoice Generated</h3>
              <p className="mt-0.5 text-sm text-white/70">{regionResult.customerName} — all warehouses combined</p>
            </div>
            <button onClick={handleReset} className="rounded-lg border border-white/30 px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/15 transition-colors">
              Start New
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #0c1a3a 0%, #1e3a8a 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{regionResult.summary.totalTransactions}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Transactions</div>
              <div className="mt-3 h-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/60" style={{ width: '100%' }} /></div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #064e3b 0%, #10b981 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{regionResult.summary.matched}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Matched</div>
              <div className="mt-3 h-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/60" style={{ width: `${regionResult.summary.totalTransactions ? Math.round((regionResult.summary.matched / regionResult.summary.totalTransactions) * 100) : 0}%` }} /></div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #7c2d12 0%, #f59e0b 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{regionResult.summary.unmatched}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Unmatched</div>
              <div className="mt-3 h-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/60" style={{ width: `${regionResult.summary.totalTransactions ? Math.round((regionResult.summary.unmatched / regionResult.summary.totalTransactions) * 100) : 0}%` }} /></div>
            </div>
            <div className="rounded-2xl p-5 shadow-md text-white" style={{ background: 'linear-gradient(135deg, #0c4a6e 0%, #0284c7 100%)' }}>
              <div className="text-4xl font-bold tracking-tight">{regionResult.summary.filledRows}</div>
              <div className="mt-1.5 text-sm font-medium text-white/70">Rows Filled</div>
              <div className="mt-3 h-1 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/60" style={{ width: '100%' }} /></div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-md space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Per-Warehouse Results</h4>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr style={{ background: 'linear-gradient(90deg, #f8f7ff 0%, #eef5ff 100%)' }}>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Warehouse</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Matched</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Unmatched</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Rows Filled</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {regionResult.warehouseBreakdown.map((item, i) => (
                    <tr key={i} className={`border-t border-slate-100 hover:bg-[#f8f7ff] transition-colors ${i % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}`}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{item.warehouse}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-600">{item.matched}</td>
                      <td className="px-4 py-3 text-right text-amber-600">{item.unmatched}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#0369a1]">{item.filledRows ?? '—'}</td>
                      <td className="px-4 py-3">
                        {item.error ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Error</span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {regionResult.errors.length > 0 && (
              <div className="rounded border border-red-200 bg-red-50 p-4">
                <h4 className="font-semibold text-red-800 mb-2">Errors</h4>
                <ul className="text-sm text-red-700 space-y-1">
                  {regionResult.errors.map((err, i) => <li key={i}>{err}</li>)}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleRegionDownload}
                disabled={loading}
                className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 transition-all hover:shadow-lg active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' }}
              >
                {loading ? 'Downloading…' : '⬇ Download Combined Invoice'}
              </button>
              <button
                onClick={handleReset}
                disabled={loading}
                className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors"
              >
                Start New
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableauCopiedSheetsPanel({ results }: { results: TableauCopyResult[] }) {
  const hasIssues = results.some(r => r.status === 'failed' || r.status === 'skipped');

  return (
    <section className="rounded-2xl bg-white p-4 shadow-md space-y-3">
      <h4 className="font-semibold text-slate-950">Tableau Copied Sheets</h4>

      {hasIssues && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <span className="font-semibold">Warning:</span> The invoice file was generated, but one or more Tableau copy steps did not complete successfully. Download the invoice and verify the affected sheets manually.
        </div>
      )}

      <div className="space-y-2">
        {results.map((r, i) => {
          const isCopied  = r.status === 'copied';
          const isSkipped = r.status === 'skipped';

          const rowCls = isCopied
            ? 'border-green-200 bg-green-50'
            : isSkipped
            ? 'border-amber-200 bg-amber-50'
            : 'border-red-200 bg-red-50';

          const iconCls = isCopied
            ? 'text-green-700'
            : isSkipped
            ? 'text-amber-700'
            : 'text-red-700';

          const labelCls = isCopied
            ? 'text-green-800'
            : isSkipped
            ? 'text-amber-800'
            : 'text-red-800';

          const detailCls = isCopied
            ? 'text-green-700'
            : isSkipped
            ? 'text-amber-700'
            : 'text-red-700';

          const badgeCls = isCopied
            ? 'bg-green-100 text-green-700'
            : isSkipped
            ? 'bg-amber-100 text-amber-700'
            : 'bg-red-100 text-red-700';

          const icon = isCopied ? '✓' : isSkipped ? '⚠' : '✕';

          const modeLabel = r.mode === 'target_range' ? 'Target range' : 'New sheet';
          const sizeLabel = r.rowsCopied != null
            ? `${r.rowsCopied} rows × ${r.columnsCopied ?? '?'} cols`
            : null;

          const detail = isCopied
            ? [sizeLabel, r.mode === 'target_range' && r.startCell ? `→ ${r.sheetName}!${r.startCell}` : null].filter(Boolean).join(' ')
            : isSkipped
            ? `Skipped — ${r.error ?? 'unknown reason'}`
            : `Failed — ${r.error ?? 'unknown error'}`;

          return (
            <div key={i} className={`flex items-start gap-3 rounded border px-3 py-2.5 text-sm ${rowCls}`}>
              <span className={`mt-0.5 shrink-0 font-bold ${iconCls}`}>{icon}</span>
              <div className="min-w-0 flex-1">
                <div className={`font-semibold ${labelCls}`}>{r.sheetName}</div>
                <div className={`mt-0.5 text-xs ${detailCls}`}>{detail}</div>
                <div className={`mt-0.5 text-xs ${detailCls} opacity-70`}>{modeLabel}</div>
              </div>
              <span className={`ml-auto mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${badgeCls}`}>
                {r.status}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RuleDiagnosticsPanel({
  diagnostics,
  totalIssues,
  emptyMessage,
}: {
  diagnostics: RuleDiagnostic[];
  totalIssues: number;
  emptyMessage: string;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-md">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="font-semibold text-slate-950">Rule Review Details</h4>
        <span className="text-xs font-semibold text-slate-500">
          {totalIssues > diagnostics.length ? `Showing ${diagnostics.length} of ${totalIssues}` : `${totalIssues} issue${totalIssues === 1 ? '' : 's'}`}
        </span>
      </div>

      {diagnostics.length === 0 ? (
        <div className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {emptyMessage}
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="p-2 text-left">Transaction</th>
                <th className="p-2 text-left">Steps</th>
                <th className="p-2 text-left">Rule Result</th>
                <th className="p-2 text-left">Matched Line</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.map(diagnostic => (
                <tr key={diagnostic.transactionId} className="border-b border-slate-200 align-top last:border-0">
                  <td className="p-2 font-mono text-xs text-slate-700">{diagnostic.transactionId || '-'}</td>
                  <td className="p-2 text-slate-700">{diagnostic.executedSteps.length}</td>
                  <td className="p-2">
                    <div className={diagnostic.success ? 'font-semibold text-green-700' : 'font-semibold text-red-700'}>
                      {diagnostic.success ? 'Passed' : 'Failed'}
                    </div>
                    {diagnostic.errors.length > 0 && (
                      <div className="mt-1 text-xs text-red-700">{diagnostic.errors.join('; ')}</div>
                    )}
                    {diagnostic.warnings.length > 0 && (
                      <div className="mt-1 text-xs text-amber-700">{diagnostic.warnings.join('; ')}</div>
                    )}
                  </td>
                  <td className="p-2 text-xs text-slate-700">
                    {diagnostic.matchedLineItem ? (
                      <div>
                        <div className="font-semibold text-slate-900">
                          {diagnostic.matchedLineItem.sheet || 'Sheet'} row {diagnostic.matchedLineItem.row || '-'}
                        </div>
                        <div>{diagnostic.matchedLineItem.segment || '-'} / {diagnostic.matchedLineItem.clause || '-'}</div>
                      </div>
                    ) : (
                      <span className="text-slate-500">No rule match</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
