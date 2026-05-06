import { useEffect, useState } from 'react';
import { api } from '../../api';
import { RuleBuilder, type CustomerRuleDefinition } from './RuleBuilder';
import { RuleTest } from './RuleTest';
import type { Pricelist } from '../../types';

type ViewMode = 'list' | 'edit' | 'test';

const defaultCustomers = ['Afimilk New Zealand', 'Sensos'];

export function CustomerRules() {
  const [rules, setRules] = useState<CustomerRuleDefinition[]>([]);
  const [pricelists, setPricelists] = useState<Pricelist[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedRule, setSelectedRule] = useState<CustomerRuleDefinition | undefined>();
  const [mode, setMode] = useState<ViewMode>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const customers = Array.from(
    new Set([
      ...defaultCustomers,
      ...pricelists.map(p => p.customer_name).filter(Boolean),
      ...rules.map(r => r.customer_id).filter(Boolean),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const filteredRules = selectedCustomer
    ? rules.filter(rule => rule.customer_id === selectedCustomer)
    : rules;

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [ruleData, pricelistData] = await Promise.all([
        api.getRules(),
        api.getPricelists(),
      ]);
      setRules(ruleData);
      setPricelists(pricelistData);
      if (!selectedCustomer) {
        const firstCustomer = ruleData[0]?.customer_id || pricelistData[0]?.customer_name || defaultCustomers[0];
        setSelectedCustomer(firstCustomer);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const startNewRule = () => {
    setSelectedRule(undefined);
    setMode('edit');
  };

  const handleSaved = (rule: CustomerRuleDefinition) => {
    setSelectedRule(rule);
    setSelectedCustomer(rule.customer_id);
    setMode('list');
    loadData();
  };

  const handleToggle = async (rule: CustomerRuleDefinition) => {
    try {
      await api.toggleRule(rule.id!, !rule.enabled);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule');
    }
  };

  const handleDelete = async (rule: CustomerRuleDefinition) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await api.deleteRule(rule.id!);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  if (mode === 'edit') {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#58a967]">Rule Editor</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
              {selectedRule ? 'Edit Customer Rule' : 'Create Customer Rule'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setMode('list')}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          >
            Back to Rules
          </button>
        </div>
        <RuleBuilder
          customerId={selectedRule?.customer_id || selectedCustomer || defaultCustomers[0]}
          existingRule={selectedRule}
          onSave={handleSaved}
        />
      </div>
    );
  }

  if (mode === 'test' && selectedRule) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#58a967]">Rule Test</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">{selectedRule.name}</h2>
          </div>
          <button
            type="button"
            onClick={() => setMode('list')}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          >
            Back to Rules
          </button>
        </div>
        <RuleTest rule={selectedRule} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#58a967]">Rule Control</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Customer Rules</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Manage database-backed customer billing rules without changing code.
          </p>
        </div>
        <button
          type="button"
          onClick={startNewRule}
          className="rounded bg-[#28258b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70]"
        >
          New Rule
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="block w-full sm:max-w-sm">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Customer</span>
            <select
              value={selectedCustomer}
              onChange={event => setSelectedCustomer(event.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
            >
              {customers.map(customer => (
                <option key={customer} value={customer}>{customer}</option>
              ))}
            </select>
          </label>
          <div className="text-sm text-slate-600">
            {filteredRules.length} rule{filteredRules.length === 1 ? '' : 's'} found
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">Editable Rules</h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-600">Loading rules...</div>
        ) : filteredRules.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-base font-semibold text-slate-800">No rules for this customer yet</div>
            <button
              type="button"
              onClick={startNewRule}
              className="mt-4 rounded bg-[#28258b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70]"
            >
              Create First Rule
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="p-4 text-left font-semibold">Rule</th>
                  <th className="p-4 text-left font-semibold">Type</th>
                  <th className="p-4 text-left font-semibold">Steps</th>
                  <th className="p-4 text-left font-semibold">Status</th>
                  <th className="p-4 text-left font-semibold">Updated</th>
                  <th className="p-4 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.map(rule => (
                  <tr key={rule.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="p-4">
                      <div className="font-semibold text-slate-950">{rule.name}</div>
                      <div className="mt-1 max-w-lg text-xs text-slate-500">{rule.description || 'No description'}</div>
                    </td>
                    <td className="p-4 capitalize">{rule.ruleType}</td>
                    <td className="p-4">{rule.steps.length}</td>
                    <td className="p-4">
                      <button
                        type="button"
                        onClick={() => handleToggle(rule)}
                        className={`rounded px-2.5 py-1 text-xs font-semibold ${
                          rule.enabled
                            ? 'bg-[#e9f6ec] text-[#28753a]'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {rule.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                    <td className="p-4 text-slate-600">
                      {rule.updated_at ? new Date(rule.updated_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRule(rule);
                            setMode('edit');
                          }}
                          className="rounded bg-[#28258b]/10 px-3 py-1 text-xs font-semibold text-[#28258b] hover:bg-[#28258b]/15"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRule(rule);
                            setMode('test');
                          }}
                          className="rounded bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                        >
                          Test
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(rule)}
                          className="rounded bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
