import { useState, useEffect, useMemo } from 'react';
import { api } from '../../api';
import type { Pricelist, PreviewResponse, GenerateResponse, RuleDiagnostic, TableauCopyResult } from '../../types';

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
  const [resolvedItems, setResolvedItems] = useState<Record<string, number>>({});
  const [duplicateWarning, setDuplicateWarning] = useState<{ generatedAt: string; existingAuditLogId: number } | null>(null);
  const [reviewWarning, setReviewWarning] = useState<{ count: number } | null>(null);
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);
  const [confirmedReviewSkip, setConfirmedReviewSkip] = useState(false);

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
    setStep('select');
    setError(null);
    setResolvedItems({});
    setDuplicateWarning(null);
    setReviewWarning(null);
    setConfirmedDuplicate(false);
    setConfirmedReviewSkip(false);
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

    await executeGenerate(confirmedDuplicate, confirmedReviewSkip);
  };

  const executeGenerate = async (force: boolean, forceReview: boolean) => {
    try {
      setLoading(true);
      setError(null);
      setDuplicateWarning(null);
      setReviewWarning(null);
      const data = await api.generateInvoice(Number(selectedPricelist), startDate, endDate, resolvedItems, force, forceReview);
      setResult(data);
      setStep('result');
      setConfirmedDuplicate(false);
      setConfirmedReviewSkip(false);
    } catch (err) {
      if ((err as any).isDuplicate) {
        setDuplicateWarning({ generatedAt: (err as any).generatedAt, existingAuditLogId: (err as any).existingAuditLogId });
      } else if ((err as any).isUnresolvedReview) {
        setReviewWarning({ count: (err as any).unresolvedCount });
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
    const res = await fetch(url);
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

  const handleApplyResolutions = async () => {
    await executePreview(resolvedItems);
  };

  const handleReset = () => {
    setStep('select');
    setPreview(null);
    setResult(null);
    setError(null);
    setResolvedItems({});
    setDuplicateWarning(null);
    setReviewWarning(null);
    setConfirmedDuplicate(false);
    setConfirmedReviewSkip(false);
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

        const res = await api.exportTotal(Number(selectedPricelist), startDate, endDate, resolvedItems);
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
      <section className="rounded border border-slate-200 bg-white p-5 shadow-sm">
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
          <div className="grid min-w-full grid-cols-3 rounded border border-slate-200 bg-slate-50 p-1 text-center text-xs font-semibold text-slate-600 sm:min-w-[420px]">
            <div className={`rounded px-3 py-2 ${step === 'select' ? 'bg-[#28258b] text-white' : ''}`}>
              1. Setup
            </div>
            <div className={`rounded px-3 py-2 ${step === 'preview' ? 'bg-[#28258b] text-white' : ''}`}>
              2. Review
            </div>
            <div className={`rounded px-3 py-2 ${step === 'result' ? 'bg-[#28258b] text-white' : ''}`}>
              3. Download
            </div>
          </div>
        </div>
      </section>

      {step === 'select' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded border border-slate-200 bg-white p-5 shadow-sm">
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
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20 disabled:bg-slate-100 disabled:text-slate-400"
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
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400 focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
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
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400 focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
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
              <div className="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setBillingCycle('full_month')}
                  className={`rounded px-4 py-2 text-sm font-semibold transition-colors ${
                    billingCycle === 'full_month'
                      ? 'bg-white text-[#28258b] shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Full Month
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle('custom')}
                  className={`rounded px-4 py-2 text-sm font-semibold transition-colors ${
                    billingCycle === 'custom'
                      ? 'bg-white text-[#28258b] shadow-sm'
                      : 'text-slate-600 hover:text-slate-950'
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
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
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
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
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
              className="mt-5 w-full rounded bg-[#28258b] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1f1d70] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Loading Preview...' : 'Preview Invoice Match'}
            </button>
          </section>

          <aside className="rounded border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-slate-950">Selection Summary</h3>
            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-slate-500">Customer</dt>
                <dd className="mt-1 font-semibold text-slate-900">{selectedCustomer || 'Not selected'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Warehouse</dt>
                <dd className="mt-1 font-semibold text-slate-900">{selectedWarehouse || 'Not selected'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Pricelist</dt>
                <dd className="mt-1 font-semibold text-slate-900">{selectedPricelistRecord?.name || 'Not selected'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Billing dates</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {startDate && endDate ? `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}` : 'Not selected'}
                </dd>
              </div>
            </dl>
            <div className="mt-5 rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              The preview step checks how many Tableau transactions match the selected pricelist before the invoice is generated.
            </div>
          </aside>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="rounded border border-slate-200 bg-white p-5 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Review Match Quality</h3>
              <p className="mt-1 text-sm text-slate-600">{preview.pricelist.name}</p>
            </div>
            <button
              onClick={handleReset}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 text-center sm:grid-cols-3">
            <div className="rounded border border-slate-200 bg-slate-50 p-4">
              <div className="text-2xl font-bold text-slate-950">
                {preview.summary.totalTransactions}
              </div>
              <div className="text-sm text-slate-600">Total Transactions</div>
            </div>
            <div className="rounded border border-green-200 bg-green-50 p-4">
              <div className="text-2xl font-bold text-green-700">
                {preview.summary.matched}
              </div>
              <div className="text-sm text-green-600">Matched</div>
            </div>
            <div className="rounded border border-amber-200 bg-amber-50 p-4">
              <div className="text-2xl font-bold text-amber-700">
                {preview.summary.unmatched}
              </div>
              <div className="text-sm text-amber-700">Needs Review</div>
            </div>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-700">
              <span>Match Rate</span>
              <span>{previewMatchRate}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[#58a967]"
                style={{ width: `${previewMatchRate}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <div>Matched: {preview.summary.matched}</div>
              <div>Unmatched: {preview.summary.unmatched}</div>
            </div>
          </div>

          <div className={`rounded border p-4 text-sm ${
            preview.activeRule
              ? 'border-[#28258b]/20 bg-[#28258b]/10 text-[#28258b]'
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

          {preview.unmatched.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-4">
              <h4 className="font-semibold text-amber-900 mb-2">
                {preview.unmatched.length} transactions need review
              </h4>
              <div className="text-sm text-amber-800 space-y-2">
                {preview.unmatched.slice(0, 5).map((u, i) => (
                  <div key={i} className="border-b border-amber-200 pb-2 last:border-0">
                    <div className="font-medium">
                      {u.transaction.segment} - {u.transaction.movementType} 
                      {u.transaction.category && ` (${u.transaction.category})`}
                    </div>
                    <div className="ml-2 text-xs text-amber-700">
                      Order: {u.transaction.orderNumber} | QTY: {u.transaction.quantity} | {u.reason}
                    </div>
                    {u.alternatives && u.alternatives.length > 0 && (
                      <div className="ml-2 mt-1 text-xs text-amber-700">
                        Possible matches: {u.alternatives.length} alternatives
                      </div>
                    )}
                  </div>
                ))}
                {preview.unmatched.length > 5 && (
                  <div className="text-center">... and {preview.unmatched.length - 5} more</div>
                )}
              </div>
            </div>
          )}

          {preview.reviewQueue && preview.reviewQueue.length > 0 && (
            <ReviewQueuePanel
              reviewQueue={preview.reviewQueue}
              resolvedItems={resolvedItems}
              onResolve={(txId: string, idx: number | null) =>
                setResolvedItems(prev =>
                  idx === null
                    ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== txId))
                    : { ...prev, [txId]: idx }
                )
              }
              onApply={handleApplyResolutions}
              loading={loading}
            />
          )}

          {/* Show matched transactions summary */}
          {preview.summary.matched > 0 && (
            <div className="rounded border border-green-200 bg-green-50 p-4">
              <h4 className="font-semibold text-green-800 mb-2">
                {preview.summary.matched} Matched Transactions
              </h4>
              <p className="text-sm text-green-700">
                These transactions will be aggregated and filled into the pricelist:
              </p>
              <div className="mt-2 text-sm text-green-700">
                <div className="grid grid-cols-2 gap-2">
                  <div>Inbound Orders: {preview.transactions?.filter((t) => t.segment === 'Inbound').length || 0}</div>
                  <div>Outbound Orders: {preview.transactions?.filter((t) => t.segment === 'Outbound').length || 0}</div>
                </div>
              </div>
            </div>
          )}

          {reviewWarning && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-900">
                {reviewWarning.count} transaction{reviewWarning.count !== 1 ? 's' : ''} still need your selection
              </p>
              <p className="mt-1 text-sm text-red-800">
                Scroll up to the review queue and pick the correct pricelist row for each one. If you skip them, those transactions will be missing from the invoice.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setConfirmedReviewSkip(true); executeGenerate(confirmedDuplicate, true); }}
                  disabled={loading}
                  className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Skip them and generate anyway
                </button>
                <button
                  type="button"
                  onClick={() => { setReviewWarning(null); setConfirmedReviewSkip(false); }}
                  className="rounded border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100"
                >
                  Go back and resolve
                </button>
              </div>
            </div>
          )}

          {duplicateWarning && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                An invoice for this period was already generated
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Generated on {new Date(duplicateWarning.generatedAt).toLocaleString()}. Generating again will create a second invoice for the same period.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setConfirmedDuplicate(true); executeGenerate(true, confirmedReviewSkip); }}
                  disabled={loading}
                  className="rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Generate anyway
                </button>
                <button
                  type="button"
                  onClick={() => { setDuplicateWarning(null); setConfirmedDuplicate(false); }}
                  className="rounded border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
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
              className="flex-1 rounded bg-[#58a967] px-4 py-3 text-sm font-semibold text-white hover:bg-[#43864f] disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Invoice'}
            </button>
            <button
              type="button"
              onClick={handleDownloadTotal}
              disabled={loading}
              className="rounded border border-[#28258b]/20 bg-[#28258b]/10 px-4 py-3 text-sm font-semibold text-[#28258b] hover:bg-[#28258b]/15 disabled:opacity-50"
            >
              Download Total
            </button>
            <button
              onClick={handleReset}
              disabled={loading}
              className="rounded border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="rounded border border-slate-200 bg-white p-5 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">
                Invoice Generated Successfully
              </h3>
              <p className="mt-1 text-sm text-slate-600">Download the final invoice file or export the transaction review.</p>
            </div>
            <button
              onClick={handleReset}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Start New
            </button>
          </div>

          <div className="grid gap-4 text-center sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-slate-200 bg-slate-50 p-4">
              <div className="text-2xl font-bold text-slate-950">
                {result.summary.totalTransactions}
              </div>
              <div className="text-sm text-slate-600">Transactions</div>
            </div>
            <div className="rounded border border-green-200 bg-green-50 p-4">
              <div className="text-2xl font-bold text-green-700">
                {result.summary.matched}
              </div>
              <div className="text-sm text-green-600">Matched</div>
            </div>
            <div className="rounded border border-amber-200 bg-amber-50 p-4">
              <div className="text-2xl font-bold text-amber-700">
                {result.summary.unmatched}
              </div>
              <div className="text-sm text-amber-700">Unmatched</div>
            </div>
            <div className="rounded border border-[#28258b]/20 bg-[#28258b]/10 p-4">
              <div className="text-2xl font-bold text-[#28258b]">
                {result.summary.filledRows}
              </div>
              <div className="text-sm text-[#28258b]">Rows Filled</div>
            </div>
          </div>

          <div className={`rounded border p-4 text-sm ${
            result.activeRule
              ? 'border-[#28258b]/20 bg-[#28258b]/10 text-[#28258b]'
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
            <div className="overflow-x-auto">
              <h4 className="mb-2 font-semibold text-slate-950">Filled Rows</h4>
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="p-2 text-left">Sheet</th>
                    <th className="p-2 text-left">Row</th>
                    <th className="p-2 text-right">Old QTY</th>
                    <th className="p-2 text-right">New QTY</th>
                    <th className="p-2 text-right">Old Total</th>
                    <th className="p-2 text-right">New Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.filledRows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="p-2">{row.sheet}</td>
                      <td className="p-2">{row.row}</td>
                      <td className="p-2 text-right">{row.oldQty ?? '-'}</td>
                      <td className="p-2 text-right font-semibold text-green-700">
                        {row.newQty}
                      </td>
                      <td className="p-2 text-right">{row.oldTotal.toFixed(2)}</td>
                      <td className="p-2 text-right font-semibold">
                        {row.newTotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {result.filledRows.length > 10 && (
                    <tr>
                      <td colSpan={6} className="p-2 text-center text-slate-500">
                        ... and {result.filledRows.length - 10} more rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
              className="flex-1 rounded border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Back to Review
            </button>
            <button
              type="button"
              onClick={handleDownloadTotal}
              disabled={loading}
              className="flex-1 rounded border border-[#28258b]/20 bg-[#28258b]/10 px-4 py-3 text-sm font-semibold text-[#28258b] hover:bg-[#28258b]/15 disabled:opacity-50"
            >
              Download Total
            </button>
            <button
              onClick={handleDownload}
              disabled={loading}
              className="flex-1 rounded bg-[#28258b] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50"
            >
              Download Invoice Excel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Build a stable fingerprint for a set of alternatives so we can group
// transactions that face the exact same pricelist choices.
function altFingerprint(alternatives: Array<{ lineItem: { row: number; rate: number } }>): string {
  return alternatives.map(a => `${a.lineItem.row}:${a.lineItem.rate}`).sort().join('|');
}

// Human-readable label for a pricelist line item — segment/clause first,
// remark only as secondary context, always show row number.
function altLabel(lineItem: {
  segment: string; clause: string; remark: string; rate: number; row: number;
}): { primary: string; secondary: string; rowNum: string } {
  const segClause = [lineItem.segment, lineItem.clause].filter(Boolean).join(' / ');
  const primary   = segClause || lineItem.remark || `Row ${lineItem.row}`;
  const secondary = segClause && lineItem.remark && lineItem.remark !== primary
    ? lineItem.remark
    : '';
  return { primary, secondary, rowNum: `Row ${lineItem.row}` };
}

function ReviewQueuePanel({
  reviewQueue,
  resolvedItems,
  onResolve,
  onApply,
  loading,
}: {
  reviewQueue: NonNullable<PreviewResponse['reviewQueue']>;
  resolvedItems: Record<string, number>;
  onResolve: (txId: string, idx: number | null) => void;
  onApply: () => void;
  loading: boolean;
}) {
  const [flagged,      setFlagged]      = useState<Set<string>>(new Set());
  const [expandedGrps, setExpandedGrps] = useState<Set<string>>(new Set());
  const [flaggedOpen,  setFlaggedOpen]  = useState(false);

  const toggleFlag = (txId: string) => {
    setFlagged(prev => {
      const next = new Set(prev);
      if (next.has(txId)) { next.delete(txId); }
      else { next.add(txId); onResolve(txId, null); }
      return next;
    });
  };

  const toggleGroup = (key: string) =>
    setExpandedGrps(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Apply one alternative choice to every transaction in a group
  const applyToGroup = (items: typeof reviewQueue, idx: number) =>
    items.forEach(item => onResolve(item.transaction.id, idx));

  const activeItems  = reviewQueue.filter(item => !flagged.has(item.transaction.id));
  const flaggedItems = reviewQueue.filter(item =>  flagged.has(item.transaction.id));

  // Group active items by their alternative fingerprint
  const groupMap = new Map<string, typeof reviewQueue>();
  for (const item of activeItems) {
    const key = altFingerprint(item.alternatives);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(item);
  }
  const groups = Array.from(groupMap.entries());

  const resolvedCount = reviewQueue.filter(item =>
    resolvedItems[item.transaction.id] !== undefined || flagged.has(item.transaction.id)
  ).length;
  const allDone = resolvedCount === reviewQueue.length;

  const renderGroup = (groupKey: string, items: typeof reviewQueue) => {
    const representative = items[0];
    const alts           = representative.alternatives;
    const maxScore       = Math.max(...alts.map(a => a.score));
    const isMulti        = items.length > 1;
    const isExpanded     = expandedGrps.has(groupKey);

    // How many in this group are resolved?
    const groupResolved = items.filter(
      item => resolvedItems[item.transaction.id] !== undefined
    ).length;
    const groupChoice   = resolvedItems[items[0].transaction.id]; // choice made on first item

    // Representative transaction for labelling the group
    const tx = representative.transaction;
    const groupLabel = [tx.movementType, tx.category].filter(Boolean).join(' · ') || 'Transaction';

    return (
      <div key={groupKey} className="rounded-lg border bg-white overflow-hidden">

        {/* Group header */}
        <div className={`px-4 py-3 border-b ${groupResolved === items.length ? 'border-green-100 bg-green-50' : 'border-orange-100 bg-orange-50/40'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {groupResolved === items.length
                ? <span className="text-green-600 text-sm font-semibold">✓</span>
                : <span className="text-orange-500 text-sm">●</span>
              }
              <span className="font-semibold text-slate-900 text-sm truncate">{groupLabel}</span>
              {isMulti && (
                <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  {items.length} transactions
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {groupResolved > 0 && groupResolved < items.length && (
                <span className="text-xs text-slate-500">{groupResolved}/{items.length} done</span>
              )}
              {isMulti && (
                <button
                  type="button"
                  onClick={() => toggleGroup(groupKey)}
                  className="text-xs text-slate-500 underline hover:text-slate-800"
                >
                  {isExpanded ? 'Collapse' : `View all ${items.length}`}
                </button>
              )}
            </div>
          </div>

          {/* Transaction context — the fields that tell the user WHAT this is */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {tx.warehouse    && <span><span className="font-semibold text-slate-500">Warehouse</span> {tx.warehouse}</span>}
            {tx.segment      && <span><span className="font-semibold text-slate-500">Segment</span> {tx.segment}</span>}
            {tx.description  && <span className="truncate max-w-xs"><span className="font-semibold text-slate-500">Description</span> {tx.description}</span>}
            {tx.quantity != null && <span><span className="font-semibold text-slate-500">Qty</span> {tx.quantity} {tx.unitOfMeasure || ''}</span>}
          </div>

          {/* Show individual order numbers when collapsed (first 3) */}
          {isMulti && !isExpanded && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {items.slice(0, 3).map(item => item.transaction.orderNumber && (
                <span key={item.transaction.id} className="rounded bg-white border border-slate-200 px-1.5 py-0.5 text-xs font-mono text-slate-500">
                  {item.transaction.orderNumber}
                </span>
              ))}
              {items.length > 3 && (
                <span className="text-xs text-slate-400">+{items.length - 3} more</span>
              )}
            </div>
          )}
        </div>

        {/* Expanded individual transactions */}
        {isMulti && isExpanded && (
          <div className="border-b border-slate-100 divide-y divide-slate-100">
            {items.map(item => {
              const t = item.transaction;
              const isItemResolved = resolvedItems[t.id] !== undefined;
              return (
                <div key={t.id} className={`px-4 py-2 text-xs flex items-center gap-3 ${isItemResolved ? 'bg-green-50' : ''}`}>
                  {isItemResolved
                    ? <span className="text-green-600 font-semibold">✓</span>
                    : <span className="text-orange-400">·</span>
                  }
                  <span className="font-mono font-semibold text-slate-700">{t.orderNumber || <em className="text-slate-400">no order</em>}</span>
                  {t.warehouse   && <span className="text-slate-500">{t.warehouse}</span>}
                  {t.description && <span className="text-slate-400 truncate">{t.description}</span>}
                  {t.quantity != null && <span className="ml-auto text-slate-500 shrink-0">Qty {t.quantity}</span>}
                  <button
                    type="button"
                    onClick={() => toggleFlag(t.id)}
                    className="shrink-0 text-slate-400 hover:text-orange-600 underline"
                  >
                    Flag
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Pricelist alternatives */}
        <div className="p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            {alts.length === 1 ? 'Confirm this pricelist row' : 'Which pricelist row is this?'}
          </p>
          {alts.map((alt, idx) => {
            const isSelected  = groupChoice === idx;
            const isBest      = alt.score === maxScore;
            const sheet       = (alt.lineItem as any).sheet as string | undefined;
            const rate        = alt.lineItem.rate != null
              ? `$${Number(alt.lineItem.rate).toFixed(2)} / unit`
              : null;
            const { primary, secondary, rowNum } = altLabel(alt.lineItem);

            return (
              <label
                key={idx}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  isSelected
                    ? 'border-[#28258b] bg-[#28258b]/5'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name={`grp-${groupKey}`}
                  checked={isSelected}
                  onChange={() => applyToGroup(items, idx)}
                  className="shrink-0 mt-0.5"
                />
                <div className="flex flex-1 items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0 space-y-0.5">
                    {/* Primary label: segment / clause */}
                    <span className="font-semibold text-slate-800 block">{primary}</span>
                    {/* Secondary details row */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                      {secondary && <span>{secondary}</span>}
                      {sheet     && <span className="text-slate-400">{sheet}</span>}
                      <span className="text-slate-400 font-mono">{rowNum}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 mt-0.5">
                    {rate && <span className="text-sm font-semibold text-slate-700">{rate}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isBest ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {isBest ? 'Best match' : 'Alt match'}
                    </span>
                  </div>
                </div>
              </label>
            );
          })}

          {/* Apply to all / per-item flag actions */}
          <div className="flex items-center justify-between pt-1">
            {isMulti && groupChoice !== undefined && groupResolved < items.length && (
              <button
                type="button"
                onClick={() => applyToGroup(items, groupChoice)}
                className="text-xs font-semibold text-[#28258b] hover:underline"
              >
                Apply to all {items.length} transactions →
              </button>
            )}
            {!isMulti && (
              <button
                type="button"
                onClick={() => toggleFlag(representative.transaction.id)}
                className="text-xs text-slate-500 border border-slate-200 rounded px-2 py-1 hover:border-orange-300 hover:text-orange-600 transition-colors"
              >
                Flag for later
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-base font-semibold text-orange-900">
            {activeItems.length} transaction{activeItems.length !== 1 ? 's' : ''} need your input
          </h4>
          <p className="mt-1 text-sm text-orange-800">
            {groups.length < activeItems.length
              ? `Grouped into ${groups.length} decision${groups.length !== 1 ? 's' : ''} — choose once, apply to all similar.`
              : 'Pick the correct pricelist row for each transaction, or flag it for later.'
            }
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
          allDone ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
        }`}>
          {resolvedCount}/{reviewQueue.length} done
        </span>
      </div>

      {/* Groups */}
      <div className="space-y-3">
        {groups.map(([key, items]) => renderGroup(key, items))}
      </div>

      {/* Flagged for later */}
      {flaggedItems.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => setFlaggedOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <span>🚩 Flagged for later ({flaggedItems.length})</span>
            <span className="text-slate-400">{flaggedOpen ? '▲' : '▼'}</span>
          </button>
          {flaggedOpen && (
            <div className="border-t border-slate-100 p-3 space-y-2">
              <p className="text-xs text-slate-500 mb-2">Excluded from invoice. Unflag to reconsider.</p>
              {flaggedItems.map(item => {
                const tx = item.transaction;
                return (
                  <div key={tx.id} className="flex items-center justify-between gap-3 rounded border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="min-w-0 space-y-0.5">
                      <span className="text-sm font-mono font-semibold text-slate-700">{tx.orderNumber || tx.id}</span>
                      {tx.warehouse && <span className="ml-2 text-xs text-slate-400">{tx.warehouse}</span>}
                      <span className="ml-2 text-xs text-slate-400">{[tx.movementType, tx.category].filter(Boolean).join(' · ')}</span>
                    </div>
                    <button type="button" onClick={() => toggleFlag(tx.id)}
                      className="text-xs text-slate-500 underline hover:text-slate-800 shrink-0">
                      Unflag
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onApply}
        disabled={loading || resolvedCount === 0}
        className="w-full rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading
          ? 'Updating preview…'
          : `Confirm ${resolvedCount} resolution${resolvedCount !== 1 ? 's' : ''} & update preview`}
      </button>
    </section>
  );
}

function TableauCopiedSheetsPanel({ results }: { results: TableauCopyResult[] }) {
  const hasIssues = results.some(r => r.status === 'failed' || r.status === 'skipped');

  return (
    <section className="rounded border border-slate-200 bg-white p-4 space-y-3">
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
    <section className="rounded border border-slate-200 bg-white p-4">
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
