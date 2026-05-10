import { useEffect, useState } from 'react';
import { api } from '../../api';
import { RuleWizard } from './RuleWizard';
import type { CustomerRuleDefinition } from './RuleBuilder';
import { RuleTest } from './RuleTest';
import { RuleAssistant } from './RuleAssistant';
import type { Pricelist } from '../../types';

type ViewMode = 'list' | 'edit' | 'test' | 'assistant';

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

type LifecycleStage = 'draft' | 'tested' | 'approved' | 'active';

function getStage(rule: CustomerRuleDefinition): LifecycleStage {
  if (rule.enabled) return 'active';
  if (rule.approval_status === 'approved') return 'approved';
  if (rule.approval_status === 'tested') return 'tested';
  return 'draft';
}

function nextStepHint(rule: CustomerRuleDefinition): string {
  const stage = getStage(rule);
  if (stage === 'active')   return '';
  if (stage === 'approved') return 'Ready to enable';
  if (stage === 'tested')   return 'Awaiting approval';
  return rule.steps.length === 0 ? 'Add steps, then run a test' : 'Run a test to progress';
}

const STAGE_ORDER: LifecycleStage[] = ['draft', 'tested', 'approved', 'active'];

const STAGE_COLORS: Record<LifecycleStage, string> = {
  draft:    'bg-slate-400',
  tested:   'bg-amber-400',
  approved: 'bg-[#28258b]',
  active:   'bg-[#58a967]',
};

const STAGE_TEXT: Record<LifecycleStage, string> = {
  draft:    'text-slate-600',
  tested:   'text-amber-700',
  approved: 'text-[#28258b]',
  active:   'text-[#28753a]',
};

const STAGE_BG: Record<LifecycleStage, string> = {
  draft:    'bg-slate-100',
  tested:   'bg-amber-100',
  approved: 'bg-[#28258b]/10',
  active:   'bg-[#e9f6ec]',
};

function LifecycleBadge({ rule }: { rule: CustomerRuleDefinition }) {
  const current = getStage(rule);
  const ci = STAGE_ORDER.indexOf(current);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        {STAGE_ORDER.map((stage, i) => (
          <div key={stage} className="flex items-center gap-1">
            <div className={`h-2 w-2 rounded-full ${
              i < ci  ? 'bg-[#58a967]' :
              i === ci ? STAGE_COLORS[stage] :
                         'bg-slate-200'
            }`} />
            <span className={`text-[11px] font-medium capitalize ${
              i === ci ? STAGE_TEXT[stage] : 'text-slate-300'
            }`}>
              {stage}
            </span>
            {i < STAGE_ORDER.length - 1 && (
              <div className={`h-px w-3 ${i < ci ? 'bg-[#58a967]' : 'bg-slate-200'}`} />
            )}
          </div>
        ))}
      </div>
      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold capitalize ${STAGE_BG[current]} ${STAGE_TEXT[current]}`}>
        {current}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

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
        const firstCustomer = ruleData[0]?.customer_id || pricelistData[0]?.customer_name || '';
        setSelectedCustomer(firstCustomer);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const startNewRule = () => { setSelectedRule(undefined); setMode('edit'); };

  const handleSaved = (rule: CustomerRuleDefinition) => {
    setSelectedRule(rule);
    setSelectedCustomer(rule.customer_id);
    setMode('list');
    loadData();
  };

  const handleCreateCopy = async (rule: CustomerRuleDefinition) => {
    try {
      const copy: CustomerRuleDefinition = await api.createRuleVersion(rule.id!);
      await loadData();
      // Navigate directly into edit for the new draft copy
      setSelectedRule(copy);
      setMode('edit');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create draft copy');
    }
  };

  const handleEditWithWarning = (rule: CustomerRuleDefinition) => {
    if (rule.approval_status === 'approved') {
      if (!confirm(
        `"${rule.name}" is Approved.\n\n` +
        `Saving any changes to steps or logic will reset it to Draft and disable it — it must be re-tested and approved before it can be enabled again.\n\n` +
        `Continue editing?`
      )) return;
    } else if (rule.approval_status === 'tested') {
      if (!confirm(
        `"${rule.name}" is Tested.\n\n` +
        `Saving any changes to steps or logic will reset it to Draft — it must be re-tested and approved again.\n\n` +
        `Continue editing?`
      )) return;
    }
    setSelectedRule(rule);
    setMode('edit');
  };

  const handleToggle = async (rule: CustomerRuleDefinition) => {
    try {
      await api.toggleRule(rule.id!, !rule.enabled);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule');
    }
  };

  const handleApprove = async (rule: CustomerRuleDefinition) => {
    try {
      await api.approveRule(rule.id!);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve rule');
    }
  };

  const handleRevertToDraft = async (rule: CustomerRuleDefinition) => {
    try {
      await api.revertRuleToDraft(rule.id!);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revert rule to draft');
    }
  };

  const handleDelete = async (rule: CustomerRuleDefinition) => {
    if (!confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteRule(rule.id!);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  // ── Sub-views ──────────────────────────────────────────────────────────────

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
          <button type="button" onClick={() => setMode('list')}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">
            Back to Rules
          </button>
        </div>
        <RuleWizard
          customerId={selectedRule?.customer_id || selectedCustomer}
          existingRule={selectedRule}
          onSave={handleSaved}
        />
      </div>
    );
  }

  if (mode === 'assistant') {
    return (
      <div className="space-y-5">
        <RuleAssistant
          customerId={selectedCustomer}
          onSaved={() => { loadData(); setMode('list'); }}
          onCancel={() => setMode('list')}
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
            <p className="mt-1 text-sm text-slate-500">
              Run a test to verify the rule behaves correctly. If it passes, you can mark it as tested.
            </p>
          </div>
          <button type="button" onClick={() => setMode('list')}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">
            Back to Rules
          </button>
        </div>
        <RuleTest
          rule={selectedRule}
          onMarkedTested={() => { loadData(); setMode('list'); }}
        />
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#58a967]">Rule Control</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Customer Rules</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Manage billing rules without changing code. Each rule must be tested, approved, and enabled before it affects invoices.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode('assistant')}
            className="rounded border border-[#28258b]/30 bg-[#28258b]/10 px-4 py-2 text-sm font-semibold text-[#28258b] hover:bg-[#28258b]/15">
            AI Assistant
          </button>
          <button type="button" onClick={startNewRule}
            className="rounded bg-[#28258b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70]">
            New Rule
          </button>
        </div>
      </div>

      {/* Lifecycle guide */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-700">Lifecycle:</span>
        {(['Draft', 'Tested', 'Approved', 'Active'] as const).map((label, i, arr) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`font-semibold ${
              label === 'Draft'    ? 'text-slate-500' :
              label === 'Tested'  ? 'text-amber-600' :
              label === 'Approved'? 'text-[#28258b]' :
                                    'text-[#28753a]'
            }`}>{label}</span>
            {i < arr.length - 1 && <span className="text-slate-300">→</span>}
          </span>
        ))}
        <span className="ml-2 text-slate-400">Only Active rules affect invoices.</span>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="block w-full sm:max-w-sm">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Customer</span>
            <select
              value={selectedCustomer}
              onChange={e => setSelectedCustomer(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
            >
              {customers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="text-sm text-slate-600">
            {filteredRules.length} rule{filteredRules.length === 1 ? '' : 's'}
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">Rules</h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-600">Loading rules…</div>
        ) : filteredRules.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-base font-semibold text-slate-800">No rules for this customer yet</div>
            <button type="button" onClick={startNewRule}
              className="mt-4 rounded bg-[#28258b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70]">
              Create First Rule
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRules.map(rule => {
              const stage = getStage(rule);
              const hint  = nextStepHint(rule);
              const hasSteps = rule.steps.length > 0;

              return (
                <div key={rule.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:justify-between hover:bg-slate-50/60">

                  {/* Left: rule info */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <span className="font-semibold text-slate-950">{rule.name}</span>
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold capitalize text-slate-500">
                        {rule.ruleType}
                      </span>
                      <span className="ml-1.5 text-xs text-slate-400">
                        {hasSteps ? `${rule.steps.length} step${rule.steps.length !== 1 ? 's' : ''}` : 'no steps'}
                      </span>
                    </div>
                    {rule.description && (
                      <p className="text-xs text-slate-500 line-clamp-1">{rule.description.split('\n\n')[0]}</p>
                    )}
                    <LifecycleBadge rule={rule} />
                    {hint && (
                      <p className="text-[11px] text-slate-400">
                        Next: <span className="font-semibold text-slate-600">{hint}</span>
                      </p>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">

                    {/* Edit — gated by lifecycle stage */}
                    {stage === 'active' ? (
                      <button type="button"
                        onClick={() => handleCreateCopy(rule)}
                        title="Active rules cannot be edited in place. Creates a new draft copy you can safely change."
                        className="rounded bg-[#28258b]/10 px-3 py-1.5 text-xs font-semibold text-[#28258b] hover:bg-[#28258b]/15">
                        Create Draft Copy
                      </button>
                    ) : (stage === 'tested' || stage === 'approved') ? (
                      <button type="button"
                        onClick={() => handleEditWithWarning(rule)}
                        title="Changing steps or logic will reset this rule to Draft"
                        className="rounded bg-[#28258b]/10 px-3 py-1.5 text-xs font-semibold text-[#28258b] hover:bg-[#28258b]/15">
                        Edit
                      </button>
                    ) : (
                      <button type="button"
                        onClick={() => { setSelectedRule(rule); setMode('edit'); }}
                        className="rounded bg-[#28258b]/10 px-3 py-1.5 text-xs font-semibold text-[#28258b] hover:bg-[#28258b]/15">
                        Edit
                      </button>
                    )}

                    {/* Test — only when rule has steps */}
                    {hasSteps ? (
                      <button type="button"
                        onClick={() => { setSelectedRule(rule); setMode('test'); }}
                        className="rounded bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                        Test
                      </button>
                    ) : (
                      <span title="Add steps before testing"
                        className="cursor-not-allowed rounded bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-300">
                        Test
                      </span>
                    )}

                    {/* Approve — tested only */}
                    {stage === 'tested' && (
                      <button type="button"
                        onClick={() => handleApprove(rule)}
                        className="rounded bg-[#e9f6ec] px-3 py-1.5 text-xs font-semibold text-[#28753a] hover:bg-green-100">
                        Approve
                      </button>
                    )}

                    {/* Enable — approved+disabled only */}
                    {stage === 'approved' && (
                      <button type="button"
                        onClick={() => handleToggle(rule)}
                        className="rounded bg-[#28258b] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1f1d70]">
                        Enable
                      </button>
                    )}

                    {/* Disable — active only */}
                    {stage === 'active' && (
                      <button type="button"
                        onClick={() => handleToggle(rule)}
                        className="rounded bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200">
                        Disable
                      </button>
                    )}

                    {/* Revert to Draft — tested or approved (not active) */}
                    {(stage === 'tested' || stage === 'approved') && (
                      <button type="button"
                        onClick={() => handleRevertToDraft(rule)}
                        title="Revert to Draft so you can edit and re-test"
                        className="rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100">
                        Revert
                      </button>
                    )}

                    {/* Delete — always, but not while active */}
                    {stage !== 'active' ? (
                      <button type="button"
                        onClick={() => handleDelete(rule)}
                        className="rounded bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">
                        Delete
                      </button>
                    ) : (
                      <span title="Disable the rule before deleting"
                        className="cursor-not-allowed rounded bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-300">
                        Delete
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
