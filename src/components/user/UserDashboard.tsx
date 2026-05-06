import { useState, useEffect } from 'react';
import { api } from '../../api';
import type { Pricelist, PreviewResponse, GenerateResponse } from '../../types';

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
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'select' | 'preview' | 'result'>('select');
  const [billingCycle, setBillingCycle] = useState<'custom' | 'full_month'>('full_month');

  useEffect(() => {
    api.getPricelists().then(data => setPricelists(data)).catch(console.error);
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
  const customers = Array.from(new Set(pricelists.map(p => p.customer_name))).sort();
  
  // Get warehouses filtered by selected customer
  const warehouses = selectedCustomer 
    ? Array.from(new Set(pricelists.filter(p => p.customer_name === selectedCustomer).map(p => p.warehouse_code))).sort()
    : [];
  
  // Get pricelists filtered by customer and warehouse
  const filteredPricelists = pricelists.filter(p => 
    (!selectedCustomer || p.customer_name === selectedCustomer) &&
    (!selectedWarehouse || p.warehouse_code === selectedWarehouse)
  );

  // Auto-select pricelist when only one option exists
  useEffect(() => {
    if (filteredPricelists.length === 1 && !selectedPricelist) {
      setSelectedPricelist(filteredPricelists[0].id);
    }
  }, [filteredPricelists, selectedPricelist]);

  const handlePreview = async () => {
    console.log('Preview clicked:', { selectedPricelist, startDate, endDate });
    if (!selectedPricelist || !startDate || !endDate) {
      setError('Please select a pricelist and date range');
      return;
    }
    
    await executePreview();
  };

  const executePreview = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.previewMapping(Number(selectedPricelist), startDate, endDate);
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
    if (!selectedPricelist || !startDate || !endDate) return;
    
    await executeGenerate();
  };

  const executeGenerate = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.generateInvoice(Number(selectedPricelist), startDate, endDate);
      setResult(data);
      setStep('result');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate invoice. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
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
          const suggested = String((result as any)?.suggestedFilename || '').trim();
          if (suggested) return suggested;

          const customer = String(result?.pricelist?.customer || selectedCustomer || 'Customer').trim();
          const mm = result?.billingPeriod?.mm;
          const yyyy = result?.billingPeriod?.yyyy;
          const period = mm && yyyy ? `${mm}-${yyyy}` : '';
          const periodPart = period ? ` ${period}` : '';

          return `${customer}${periodPart} ${localStamp}.xlsx`;
        })();

        const res = await fetch(api.downloadInvoice(result.auditLogId));
        if (!res.ok) throw new Error('Failed to download invoice');

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
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

        const res = await api.exportTotal(Number(selectedPricelist), startDate, endDate);

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        a.download = downloadName;

        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  };

  const selectedPricelistRecord = pricelists.find(p => p.id === selectedPricelist);
  const readyToPreview = Boolean(selectedCustomer && selectedWarehouse && selectedPricelist && startDate && endDate);

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
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
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
                  disabled={!selectedCustomer}
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
                disabled={!selectedCustomer || !selectedWarehouse}
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

            {error && (
              <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              onClick={handlePreview}
              disabled={loading || !readyToPreview}
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
                    {u.possibleMatches && u.possibleMatches.length > 0 && (
                      <div className="ml-2 mt-1 text-xs text-amber-700">
                        Possible matches: {u.possibleMatches.length} line items
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
                  <div>Inbound Orders: {preview.transactions?.filter((t: any) => t.segment === 'Inbound').length || 0}</div>
                  <div>Outbound Orders: {preview.transactions?.filter((t: any) => t.segment === 'Outbound').length || 0}</div>
                </div>
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

          <div className="flex flex-col gap-3 sm:flex-row">
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
