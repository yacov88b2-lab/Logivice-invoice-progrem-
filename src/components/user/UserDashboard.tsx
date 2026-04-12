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
      setError('Failed to preview mapping. Please try again.');
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
      setError('Failed to generate invoice. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (result?.auditLogId) {
      window.open(api.downloadInvoice(result.auditLogId), '_blank');
    }
  };

  const handleReset = () => {
    setStep('select');
    setPreview(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Generate Invoice</h2>
        <p className="text-gray-600 mt-1">
          Select a pricelist and date range to generate an invoice with data from Tableau
        </p>
      </div>

      {step === 'select' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          {/* Step 1: Customer Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Customer *
            </label>
            <select
              value={selectedCustomer}
              onChange={(e) => {
                setSelectedCustomer(e.target.value);
                setSelectedWarehouse('');
                setSelectedPricelist('');
              }}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Choose a customer --</option>
              {customers.map(customer => (
                <option key={customer} value={customer}>
                  {customer}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: Warehouse Selection (filtered by customer) */}
          {selectedCustomer && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Warehouse *
              </label>
              <select
                value={selectedWarehouse}
                onChange={(e) => {
                  setSelectedWarehouse(e.target.value);
                  setSelectedPricelist('');
                }}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Choose a warehouse --</option>
                {warehouses.map(warehouse => (
                  <option key={warehouse} value={warehouse}>
                    {warehouse}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Step 3: Pricelist Selection (filtered by customer + warehouse) */}
          {selectedCustomer && selectedWarehouse && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Pricelist *
              </label>
              <select
                value={selectedPricelist}
                onChange={(e) => setSelectedPricelist(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Choose a pricelist --</option>
                {filteredPricelists.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {filteredPricelists.length === 0 && (
                <p className="text-sm text-red-600 mt-1">
                  No pricelists found for this customer/warehouse combination.
                </p>
              )}
            </div>
          )}

          {/* Billing Period Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Billing Period *
            </label>
            <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => setBillingCycle('full_month')}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  billingCycle === 'full_month'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Full Month
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('custom')}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  billingCycle === 'custom'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Custom Range
              </button>
            </div>
            {billingCycle === 'full_month' && startDate && endDate && (
              <p className="mt-2 text-sm text-gray-500">
                {new Date(startDate).toLocaleDateString()} - {new Date(endDate).toLocaleDateString()}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Date *
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={billingCycle === 'full_month'}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                  billingCycle === 'full_month' ? 'bg-gray-100 text-gray-500' : ''
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date *
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={billingCycle === 'full_month'}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                  billingCycle === 'full_month' ? 'bg-gray-100 text-gray-500' : ''
                }`}
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg">
              {error}
            </div>
          )}

          <button
            onClick={handlePreview}
            disabled={loading || !selectedPricelist}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Preview Mapping'}
          </button>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Preview: {preview.pricelist.name}</h3>
            <button
              onClick={handleReset}
              className="text-gray-600 hover:text-gray-900"
            >
              ← Back
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-blue-700">
                {preview.summary.totalTransactions}
              </div>
              <div className="text-sm text-blue-600">Total Transactions</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-green-700">
                {preview.summary.matched}
              </div>
              <div className="text-sm text-green-600">Matched</div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-yellow-700">
                {preview.summary.unmatched}
              </div>
              <div className="text-sm text-yellow-600">Unmatched</div>
            </div>
          </div>

          {preview.unmatched.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="font-semibold text-yellow-800 mb-2">
                ⚠️ {preview.unmatched.length} Unmatched Transactions
              </h4>
              <div className="text-sm text-yellow-700 space-y-2">
                {preview.unmatched.slice(0, 5).map((u, i) => (
                  <div key={i} className="border-b border-yellow-200 pb-2 last:border-0">
                    <div className="font-medium">
                      {u.transaction.segment} - {u.transaction.movementType} 
                      {u.transaction.category && ` (${u.transaction.category})`}
                    </div>
                    <div className="text-xs text-yellow-600 ml-2">
                      Order: {u.transaction.orderNumber} | QTY: {u.transaction.quantity} | {u.reason}
                    </div>
                    {u.possibleMatches && u.possibleMatches.length > 0 && (
                      <div className="text-xs text-yellow-600 ml-2 mt-1">
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
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-semibold text-green-800 mb-2">
                ✓ {preview.summary.matched} Matched Transactions
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

          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Invoice'}
            </button>
            <button
              onClick={handleReset}
              disabled={loading}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-green-700">
              ✓ Invoice Generated Successfully
            </h3>
            <button
              onClick={handleReset}
              className="text-gray-600 hover:text-gray-900"
            >
              Start New →
            </button>
          </div>

          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-blue-700">
                {result.summary.totalTransactions}
              </div>
              <div className="text-sm text-blue-600">Transactions</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-green-700">
                {result.summary.matched}
              </div>
              <div className="text-sm text-green-600">Matched</div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-yellow-700">
                {result.summary.unmatched}
              </div>
              <div className="text-sm text-yellow-600">Unmatched</div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-purple-700">
                {result.summary.filledRows}
              </div>
              <div className="text-sm text-purple-600">Rows Filled</div>
            </div>
          </div>

          {result.filledRows.length > 0 && (
            <div className="overflow-x-auto">
              <h4 className="font-semibold mb-2">Filled Rows</h4>
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
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
                    <tr key={i} className="border-b">
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
                      <td colSpan={6} className="p-2 text-center text-gray-500">
                        ... and {result.filledRows.length - 10} more rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h4 className="font-semibold text-red-800 mb-2">Errors</h4>
              <ul className="text-sm text-red-700">
                {result.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          <button
            onClick={handleDownload}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Download Invoice Excel
          </button>
        </div>
      )}
    </div>
  );
}
