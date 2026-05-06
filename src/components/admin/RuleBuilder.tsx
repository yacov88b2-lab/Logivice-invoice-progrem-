import { useState } from 'react';
import { api } from '../../api';

export interface RuleStep {
  id: string;
  type: string;
  enabled: boolean;
  config: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface CustomerRuleDefinition {
  id?: string;
  customer_id: string;
  name: string;
  description?: string;
  version: number;
  enabled: boolean;
  ruleType: 'matching' | 'transformation' | 'aggregation';
  steps: RuleStep[];
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
}

interface RuleBuilderProps {
  customerId: string;
  onSave: (rule: CustomerRuleDefinition) => void;
  existingRule?: CustomerRuleDefinition;
}

const STEP_TYPES: { value: string; label: string; description: string }[] = [
  { value: 'field_extraction', label: 'Extract Field', description: 'Extract and transform a transaction field' },
  { value: 'field_transform', label: 'Transform Value', description: 'Apply transformation to extracted value' },
  { value: 'match_transaction', label: 'Exact Match', description: 'Match transaction to line items by exact fields' },
  { value: 'fuzzy_match', label: 'Fuzzy Match', description: 'Match with scoring and threshold' },
  { value: 'filter', label: 'Filter', description: 'Include/exclude based on condition' },
  { value: 'aggregate', label: 'Aggregate', description: 'Sum, count, or deduplicate results' },
  { value: 'conditional', label: 'Conditional', description: 'If-then logic for branching' }
];

export function RuleBuilder({ customerId, onSave, existingRule }: RuleBuilderProps) {
  const [rule, setRule] = useState<Partial<CustomerRuleDefinition>>(
    existingRule || {
      customer_id: customerId,
      name: '',
      ruleType: 'matching',
      version: 1,
      enabled: false,
      steps: []
    }
  );

  const [selectedStep, setSelectedStep] = useState<number | null>(null);

  const addStep = (stepType: string) => {
    const newStep: RuleStep = {
      id: `step_${Date.now()}`,
      type: stepType,
      enabled: true,
      config: {}
    };

    setRule({
      ...rule,
      steps: [...(rule.steps || []), newStep]
    });

    setSelectedStep((rule.steps || []).length);
  };

  const updateStepConfig = (stepIndex: number, config: Record<string, any>) => {
    const updatedSteps = [...(rule.steps || [])];
    updatedSteps[stepIndex] = { ...updatedSteps[stepIndex], config };
    setRule({ ...rule, steps: updatedSteps });
  };

  const updateStepEnabled = (stepIndex: number, enabled: boolean) => {
    const updatedSteps = [...(rule.steps || [])];
    updatedSteps[stepIndex] = { ...updatedSteps[stepIndex], enabled };
    setRule({ ...rule, steps: updatedSteps });
  };

  const removeStep = (stepIndex: number) => {
    const updatedSteps = (rule.steps || []).filter((_, i) => i !== stepIndex);
    setRule({ ...rule, steps: updatedSteps });
    setSelectedStep(null);
  };

  const handleSave = async () => {
    if (!rule.name || !rule.steps || rule.steps.length === 0) {
      alert('Rule name and at least one step required');
      return;
    }

    try {
      const payload = {
        ...rule,
        customer_id: customerId,
        created_by: 'admin',
        updated_by: 'admin'
      };
      const saved = existingRule?.id
        ? await api.updateRule(existingRule.id, payload)
        : await api.createRule(payload);
      onSave(saved);
    } catch (error) {
      alert(`Error saving rule: ${(error as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Rule Details</h3>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium">Rule Name</label>
            <input
              type="text"
              value={rule.name || ''}
              onChange={e => setRule({ ...rule, name: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              placeholder="e.g., Afimilk Storage Matching"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Description</label>
            <textarea
              value={rule.description || ''}
              onChange={e => setRule({ ...rule, description: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              rows={2}
              placeholder="Optional description of this rule's purpose"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium">Rule Type</label>
              <select
                value={rule.ruleType || 'matching'}
                onChange={e => setRule({ ...rule, ruleType: e.target.value as any })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              >
                <option value="matching">Matching</option>
                <option value="transformation">Transformation</option>
                <option value="aggregation">Aggregation</option>
              </select>
            </div>

            <div>
              <label className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  checked={rule.enabled || false}
                  onChange={e => setRule({ ...rule, enabled: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm font-medium">Enabled</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Rule Steps</h3>

        {/* Step list */}
        <div className="mt-4 space-y-2">
          {(rule.steps || []).map((step, i) => (
            <button
              key={step.id}
              onClick={() => setSelectedStep(i)}
              className={`w-full rounded border-2 p-3 text-left transition-colors ${
                selectedStep === i
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-sm text-slate-500">Step {i + 1}:</span>
                  <span className="ml-2 font-medium">{step.type}</span>
                </div>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    removeStep(i);
                  }}
                  className="text-red-600 hover:text-red-800"
                >
                  ✕
                </button>
              </div>
            </button>
          ))}
        </div>

        {/* Step configuration */}
        {selectedStep !== null && (
          <StepConfigurator
            step={(rule.steps || [])[selectedStep]}
            onChange={config => updateStepConfig(selectedStep, config)}
            onEnabledChange={enabled => updateStepEnabled(selectedStep, enabled)}
          />
        )}

        {/* Add step dropdown */}
        <div className="mt-4">
          <label className="block text-sm font-medium">Add Step</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {STEP_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => addStep(type.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100"
                title={type.description}
              >
                + {type.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          onClick={handleSave}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Save Rule
        </button>
      </div>
    </div>
  );
}

function StepConfigurator({
  step,
  onChange,
  onEnabledChange,
}: {
  step: RuleStep;
  onChange: (config: Record<string, any>) => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
      <h4 className="font-medium">Configure: {step.type}</h4>

      {step.type === 'field_extraction' && (
        <div className="mt-3 space-y-3">
          <input
            type="text"
            placeholder="Field name (e.g., segment)"
            value={step.config.fieldName || ''}
            onChange={e => onChange({ ...step.config, fieldName: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
          <input
            type="text"
            placeholder="Output key"
            value={step.config.outputKey || ''}
            onChange={e => onChange({ ...step.config, outputKey: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
          <select
            value={step.config.transformType || 'none'}
            onChange={e => onChange({ ...step.config, transformType: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          >
            <option value="none">No transform</option>
            <option value="uppercase">Uppercase</option>
            <option value="lowercase">Lowercase</option>
            <option value="trim">Trim</option>
            <option value="parse_date">Parse date</option>
          </select>
        </div>
      )}

      {step.type === 'match_transaction' && (
        <div className="mt-3 space-y-3">
          <input
            type="text"
            placeholder="Match fields (comma-separated: segment,category,uom)"
            value={(step.config.matchFields || []).join(',')}
            onChange={e => onChange({ ...step.config, matchFields: e.target.value.split(',').map(s => s.trim()) })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
          <select
            value={step.config.conflictResolution || 'first_match'}
            onChange={e => onChange({ ...step.config, conflictResolution: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          >
            <option value="first_match">First match</option>
            <option value="ambiguous">Mark ambiguous</option>
          </select>
        </div>
      )}

      {step.type === 'filter' && (
        <div className="mt-3 space-y-3">
          <input
            type="text"
            placeholder="Field"
            value={step.config.field || ''}
            onChange={e => onChange({ ...step.config, field: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
          <select
            value={step.config.operator || 'equals'}
            onChange={e => onChange({ ...step.config, operator: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          >
            <option value="equals">Equals</option>
            <option value="contains">Contains</option>
            <option value="gt">Greater than</option>
            <option value="lt">Less than</option>
          </select>
          <input
            type="text"
            placeholder="Value"
            value={step.config.value || ''}
            onChange={e => onChange({ ...step.config, value: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
        </div>
      )}

      {step.type === 'fuzzy_match' && (
        <div className="mt-3 space-y-3">
          <input
            type="text"
            placeholder="Match fields (comma-separated)"
            value={(step.config.matchFields || []).join(',')}
            onChange={e => onChange({ ...step.config, matchFields: e.target.value.split(',').map(s => s.trim()) })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
          <input
            type="number"
            placeholder="Threshold (0-1)"
            min="0"
            max="1"
            step="0.1"
            value={step.config.threshold || 0.7}
            onChange={e => onChange({ ...step.config, threshold: parseFloat(e.target.value) })}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
        </div>
      )}

      <label className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={step.enabled}
          onChange={e => onEnabledChange(e.target.checked)}
          className="rounded"
        />
        <span className="text-sm">Enabled</span>
      </label>
    </div>
  );
}
