import { useState, useRef } from 'react';
import { api } from '../../api';
import type { CustomerRuleDefinition, RuleStep } from './RuleBuilder';
import { toast } from '../../toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 'name' | 'intent' | 'configure' | 'review';
type RuleIntent = 'match' | 'filter' | 'transform' | 'combine' | 'other' | 'tableau_copy';

interface WizardState {
  ruleName: string;
  notes: string;
  referenceUrl: string;
  intent: RuleIntent | null;
  // Tableau copy
  tableauUrl: string;
  tableauViewName: string;
  tableauTargetSheet: string;
  tableauMode: 'raw_sheet' | 'target_range';
  tableauStartCell: string;
  tableauIncludeHeaders: boolean;
  tableauUrlValidated: boolean | null;
  enabled: boolean;
  // Match
  matchField: string;
  matchCustomField: string;
  matchStyle: 'exact' | 'flexible';
  matchThreshold: number;
  matchConflict: 'first_match' | 'ambiguous';
  // Filter
  filterField: string;
  filterOperator: string;
  filterValue: string;
  filterAction: 'include' | 'exclude';
  // Transform
  transformField: string;
  transformOperation: string;
  // Combine
  combineField: string;
  combineOperation: string;
  // Other / AI-suggested
  suggestedSteps: RuleStep[] | null;
}

const DEFAULT_STATE: WizardState = {
  ruleName: '',
  notes: '',
  referenceUrl: '',
  intent: null,
  tableauUrl: '',
  tableauViewName: '',
  tableauTargetSheet: '',
  tableauMode: 'raw_sheet',
  tableauStartCell: '',
  tableauIncludeHeaders: true,
  tableauUrlValidated: null,
  enabled: true,
  matchField: '',
  matchCustomField: '',
  matchStyle: 'exact',
  matchThreshold: 0.7,
  matchConflict: 'first_match',
  filterField: '',
  filterOperator: 'equals',
  filterValue: '',
  filterAction: 'include',
  transformField: '',
  transformOperation: 'uppercase',
  combineField: '',
  combineOperation: 'sum',
  suggestedSteps: null,
};

// Actual transaction fields from the data model
const TRANSACTION_FIELDS = [
  { value: 'segment',      label: 'Segment' },
  { value: 'category',     label: 'Category' },
  { value: 'unitOfMeasure',label: 'Unit of Measure' },
  { value: 'movementType', label: 'Movement Type' },
  { value: 'description',  label: 'Description' },
  { value: 'warehouse',    label: 'Warehouse' },
  { value: 'orderNumber',  label: 'Order Number' },
];

interface RuleWizardProps {
  customerId: string;
  existingRule?: CustomerRuleDefinition;
  onSave: (rule: CustomerRuleDefinition) => void;
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export function RuleWizard({ customerId, existingRule, onSave }: RuleWizardProps) {
  const [step, setStep] = useState<WizardStep>('name');
  const [state, setState] = useState<WizardState>(() =>
    existingRule ? ruleToWizard(existingRule) : { ...DEFAULT_STATE }
  );
  const [isListening, setIsListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const update = (patch: Partial<WizardState>) => setState(s => ({ ...s, ...patch }));

  const toggleVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.info('Voice input is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join(' ');
      update({ notes: state.notes ? `${state.notes} ${transcript}` : transcript });
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  };

  const STEPS: WizardStep[] = ['name', 'intent', 'configure', 'review'];
  const stepIndex = STEPS.indexOf(step);

  const canProceed = (): boolean => {
    if (step === 'name') return state.ruleName.trim().length > 0;
    if (step === 'intent') return state.intent !== null;
    if (step === 'configure') return isConfigValid(state);
    return true;
  };

  const handleNext = () => {
    if (step === 'review') handleSave();
    else setStep(STEPS[stepIndex + 1]);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = wizardToRule(state, customerId, existingRule);
      const saved = existingRule?.id
        ? await api.updateRule(existingRule.id, payload)
        : await api.createRule(payload);
      onSave(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
      setSaving(false);
    }
  };

  const STEP_LABELS = ['Name', 'Purpose', 'Setup', 'Review'];

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <nav className="flex items-center gap-1" aria-label="Wizard steps">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              i < stepIndex  ? 'bg-[#58a967] text-white' :
              i === stepIndex ? 'bg-[#1e3a8a] text-white' :
                                'bg-slate-200 text-slate-500'
            }`}>
              {i < stepIndex ? '✓' : i + 1}
            </div>
            <span className={`text-sm ${i === stepIndex ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <div className={`mx-1 h-0.5 w-6 rounded ${i < stepIndex ? 'bg-[#58a967]' : 'bg-slate-200'}`} />
            )}
          </div>
        ))}
      </nav>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Step panel */}
      <div className="rounded-2xl bg-white p-6 shadow-md">
        {step === 'name'      && <NameStep      state={state} update={update} isListening={isListening} onToggleVoice={toggleVoice} />}
        {step === 'intent'    && <IntentStep    state={state} update={update} />}
        {step === 'configure' && <ConfigureStep state={state} update={update} customerId={customerId} />}
        {step === 'review'    && <ReviewStep    state={state} update={update} customerId={customerId} existingRule={existingRule} />}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={step === 'name'}
          onClick={() => setStep(STEPS[stepIndex - 1])}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          ← Back
        </button>
        <button
          type="button"
          disabled={!canProceed() || saving}
          onClick={handleNext}
          className="rounded-lg bg-[#1e3a8a] px-6 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-40"
        >
          {saving ? 'Saving…' : step === 'review' ? '✓ Save Rule' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

// ─── Step: Name ───────────────────────────────────────────────────────────────

function NameStep({
  state, update, isListening, onToggleVoice,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  isListening: boolean;
  onToggleVoice: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold text-slate-900">Let's name this rule</h3>
        <p className="mt-1 text-sm text-slate-500">Give it a short, clear name so you can find it later.</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700">Rule name *</label>
        <input
          type="text"
          autoFocus
          value={state.ruleName}
          onChange={e => update({ ruleName: e.target.value })}
          placeholder="e.g., Match storage transactions by segment"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-semibold text-slate-700">
            Notes <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <button
            type="button"
            onClick={onToggleVoice}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              isListening
                ? 'animate-pulse bg-red-100 text-red-700'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            🎤 {isListening ? 'Stop recording' : 'Speak your notes'}
          </button>
        </div>
        <textarea
          value={state.notes}
          onChange={e => update({ notes: e.target.value })}
          rows={3}
          placeholder="Describe in plain English what this rule should do…"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
        />
        {isListening && (
          <p className="mt-1 text-xs text-red-600">🔴 Listening… speak now. Click "Stop recording" when done.</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700">
          {state.intent === 'tableau_copy' ? 'Tableau View URL' : 'Reference link'}{' '}
          <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input
          type="url"
          value={state.referenceUrl}
          onChange={e => {
            const url = e.target.value;
            const patch: Partial<WizardState> = { referenceUrl: url };
            if (state.intent === 'tableau_copy') {
              patch.tableauUrl = url;
              patch.tableauUrlValidated = null;
            }
            update(patch);
          }}
          placeholder={
            state.intent === 'tableau_copy'
              ? 'https://dub01.online.tableau.com/#/site/logivice/views/WorkbookName/ViewName'
              : 'https://  — paste a link to a Tableau view, spreadsheet, or any reference'
          }
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
        />
        <p className="mt-1 text-xs text-slate-400">
          {state.intent === 'tableau_copy'
            ? 'For Tableau copy rules, this link will be used as the Tableau source URL.'
            : "This is saved for reference only — it won't affect how the rule runs."}
        </p>
      </div>
    </div>
  );
}

// ─── Step: Intent ─────────────────────────────────────────────────────────────

const INTENTS: { id: RuleIntent; icon: string; title: string; desc: string }[] = [
  {
    id: 'match',
    icon: '🔍',
    title: 'Match transactions',
    desc: 'Find which invoice line each transaction belongs to',
  },
  {
    id: 'filter',
    icon: '🚦',
    title: 'Include or skip transactions',
    desc: 'Only process certain transactions and ignore the rest',
  },
  {
    id: 'transform',
    icon: '🔄',
    title: 'Clean up a field',
    desc: 'Reformat or tidy up a value before matching (e.g., make it uppercase)',
  },
  {
    id: 'combine',
    icon: '➕',
    title: 'Combine rows',
    desc: 'Add up or group multiple transaction rows together',
  },
  {
    id: 'other',
    icon: '📋',
    title: 'Other / Custom',
    desc: 'Name the rule and add steps manually — useful for one-off or copy-pasted Tableau rules',
  },
  {
    id: 'tableau_copy',
    icon: '📊',
    title: 'Copy table from Tableau',
    desc: 'Fetch a Tableau view and write it into the generated workbook — as a new sheet or into a specific cell range',
  },
];

function IntentStep({
  state, update,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold text-slate-900">What should this rule do?</h3>
        <p className="mt-1 text-sm text-slate-500">Pick the option that best describes the rule's job.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {INTENTS.map(intent => (
          <button
            key={intent.id}
            type="button"
            onClick={() => {
              const patch: Partial<WizardState> = { intent: intent.id };
              if (intent.id === 'tableau_copy' && state.referenceUrl && !state.tableauUrl) {
                patch.tableauUrl = state.referenceUrl;
                patch.tableauUrlValidated = null;
              }
              update(patch);
            }}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              state.intent === intent.id
                ? 'border-[#1e3a8a] bg-[#1e3a8a]/5 shadow-sm'
                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className="text-2xl">{intent.icon}</span>
            <p className="mt-2 text-sm font-semibold text-slate-900">{intent.title}</p>
            <p className="mt-0.5 text-xs text-slate-500">{intent.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step: Configure ──────────────────────────────────────────────────────────

function ConfigureStep({
  state, update, customerId,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  customerId: string;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold text-slate-900">Set it up</h3>
        <p className="mt-1 text-sm text-slate-500">Answer a few quick questions to configure this rule.</p>
      </div>
      {state.intent === 'match'     && <MatchConfig     state={state} update={update} />}
      {state.intent === 'filter'    && <FilterConfig    state={state} update={update} />}
      {state.intent === 'transform' && <TransformConfig state={state} update={update} />}
      {state.intent === 'combine'   && <CombineConfig   state={state} update={update} />}
      {state.intent === 'other'        && <OtherConfig        state={state} update={update} customerId={customerId} />}
      {state.intent === 'tableau_copy' && <TableauCopyConfig  state={state} update={update} />}
    </div>
  );
}

// ─── Match Config ─────────────────────────────────────────────────────────────

function MatchConfig({
  state, update,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
}) {
  const effectiveField = state.matchField === '__custom__' ? state.matchCustomField : state.matchField;

  return (
    <div className="space-y-6">
      {/* Field picker */}
      <div>
        <p className="text-sm font-semibold text-slate-700">
          Which field in the transaction identifies the invoice line?
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TRANSACTION_FIELDS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => update({ matchField: f.value })}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                state.matchField === f.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a] text-white'
                  : 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => update({ matchField: '__custom__' })}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
              state.matchField === '__custom__'
                ? 'border-[#1e3a8a] bg-[#1e3a8a] text-white'
                : 'border-dashed border-slate-300 text-slate-500 hover:border-slate-400'
            }`}
          >
            Other…
          </button>
        </div>
        {state.matchField === '__custom__' && (
          <input
            type="text"
            autoFocus
            value={state.matchCustomField}
            onChange={e => update({ matchCustomField: e.target.value })}
            placeholder="Type the field name exactly as it appears in your data"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
          />
        )}
        {effectiveField && (
          <p className="mt-1 text-xs text-slate-500">
            Selected: <span className="font-semibold text-slate-700">{effectiveField}</span>
          </p>
        )}
      </div>

      {/* Match strictness */}
      <div>
        <p className="text-sm font-semibold text-slate-700">How strict should the match be?</p>
        <div className="mt-2 space-y-2">
          {[
            {
              value: 'exact',
              label: 'Exact match',
              desc: 'The field value must match the invoice line perfectly — e.g., "Storage" only matches "Storage"',
            },
            {
              value: 'flexible',
              label: 'Flexible match',
              desc: 'Allow similar text — useful when abbreviations or small typos are common (e.g., "Strg" could still match "Storage")',
            },
          ].map(opt => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                state.matchStyle === opt.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a]/5'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="matchStyle"
                checked={state.matchStyle === opt.value as any}
                onChange={() => update({ matchStyle: opt.value as any })}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Threshold when flexible */}
      {state.matchStyle === 'flexible' && (
        <div>
          <p className="text-sm font-semibold text-slate-700">How similar do they need to be?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { label: 'Loose — anything close', value: 0.5 },
              { label: 'Balanced', value: 0.7 },
              { label: 'Strict — nearly identical', value: 0.9 },
            ].map(opt => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  state.matchThreshold === opt.value
                    ? 'border-[#1e3a8a] bg-[#1e3a8a]/5 font-semibold text-[#1e3a8a]'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="threshold"
                  checked={state.matchThreshold === opt.value}
                  onChange={() => update({ matchThreshold: opt.value })}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Conflict resolution */}
      <div>
        <p className="text-sm font-semibold text-slate-700">If more than one invoice line matches…</p>
        <div className="mt-2 space-y-2">
          {[
            {
              value: 'first_match',
              label: 'Use the first match',
              desc: 'Automatically pick the first invoice line that fits',
            },
            {
              value: 'ambiguous',
              label: 'Flag it for review',
              desc: 'Mark the transaction as unclear so someone can check it manually',
            },
          ].map(opt => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                state.matchConflict === opt.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a]/5'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="matchConflict"
                checked={state.matchConflict === opt.value as any}
                onChange={() => update({ matchConflict: opt.value as any })}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Filter Config ────────────────────────────────────────────────────────────

function FilterConfig({
  state, update,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-slate-700">What should happen to matching transactions?</p>
        <div className="mt-2 flex gap-3">
          {[
            { value: 'include', label: '✅ Include them', desc: 'Only process transactions that match this condition' },
            { value: 'exclude', label: '🚫 Skip them',   desc: 'Ignore transactions that match this condition' },
          ].map(opt => (
            <label
              key={opt.value}
              className={`flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                state.filterAction === opt.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a]/5'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="filterAction"
                checked={state.filterAction === opt.value as any}
                onChange={() => update({ filterAction: opt.value as any })}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700">Which field should be checked?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TRANSACTION_FIELDS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => update({ filterField: f.value })}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                state.filterField === f.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a] text-white'
                  : 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700">Condition</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={state.filterOperator}
            onChange={e => update({ filterOperator: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none"
          >
            <option value="equals">is exactly</option>
            <option value="not_equals">is not</option>
            <option value="contains">contains</option>
            <option value="gt">is greater than</option>
            <option value="lt">is less than</option>
          </select>
          <input
            type="text"
            value={state.filterValue}
            onChange={e => update({ filterValue: e.target.value })}
            placeholder="Value…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
          />
        </div>
        {state.filterField && state.filterValue && (
          <p className="mt-2 text-xs text-slate-500">
            Preview: <span className="italic">"{state.filterField} {operatorLabel(state.filterOperator)} {state.filterValue}"</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Transform Config ─────────────────────────────────────────────────────────

function TransformConfig({
  state, update,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-slate-700">Which field needs to be cleaned up?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TRANSACTION_FIELDS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => update({ transformField: f.value })}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                state.transformField === f.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a] text-white'
                  : 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700">What should be done to it?</p>
        <div className="mt-2 space-y-2">
          {[
            { value: 'uppercase', label: 'Make it ALL CAPS',         desc: '"storage" → "STORAGE"' },
            { value: 'lowercase', label: 'Make it all lowercase',    desc: '"STORAGE" → "storage"' },
            { value: 'trim',      label: 'Remove extra spaces',      desc: '" storage " → "storage"' },
            { value: 'parse_date',label: 'Read it as a date',        desc: 'Convert text dates to a standard format' },
          ].map(opt => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                state.transformOperation === opt.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a]/5'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="transformOp"
                checked={state.transformOperation === opt.value}
                onChange={() => update({ transformOperation: opt.value })}
              />
              <div>
                <span className="text-sm font-semibold text-slate-800">{opt.label}</span>
                <span className="ml-2 text-xs text-slate-400">{opt.desc}</span>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Combine Config ───────────────────────────────────────────────────────────

function CombineConfig({
  state, update,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-slate-700">Group transactions by which field?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TRANSACTION_FIELDS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => update({ combineField: f.value })}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                state.combineField === f.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a] text-white'
                  : 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700">When combining, what should happen to the quantities?</p>
        <div className="mt-2 space-y-2">
          {[
            { value: 'sum',         label: 'Add them up',                   desc: 'Total the quantities across all matching rows' },
            { value: 'count',       label: 'Count the rows',                desc: 'Record how many transactions there were' },
            { value: 'deduplicate', label: 'Remove duplicates (keep one)',   desc: 'Keep only one entry per unique combination' },
          ].map(opt => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                state.combineOperation === opt.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a]/5'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="combineOp"
                checked={state.combineOperation === opt.value}
                onChange={() => update({ combineOperation: opt.value })}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Other Config ─────────────────────────────────────────────────────────────

function OtherConfig({
  state, update, customerId,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  customerId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSuggest = async () => {
    if (!state.notes.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.suggestRuleSteps(customerId, state.notes);
      update({ suggestedSteps: result.steps as RuleStep[] });
      toast.success('Steps suggested — review below, then save.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI suggestion failed');
    } finally {
      setLoading(false);
    }
  };

  const hasSuggestion = state.suggestedSteps !== null && state.suggestedSteps.length > 0;

  return (
    <div className="space-y-4">
      {state.notes.trim() ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Your description</p>
            <p className="text-slate-700">{state.notes}</p>
          </div>
          <button
            type="button"
            onClick={handleSuggest}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="animate-spin text-base">⏳</span> Thinking…
              </>
            ) : (
              <>✨ Suggest steps with AI</>
            )}
          </button>
          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600 space-y-1">
          <p className="font-semibold text-slate-800">No description yet</p>
          <p>Go back to step 1 and describe what this rule should do in the Notes field. The AI will use that to suggest steps.</p>
        </div>
      )}

      {hasSuggestion && (
        <div className="rounded-lg border border-[#1e3a8a]/20 bg-[#1e3a8a]/5 p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#1e3a8a]">
            AI suggested {state.suggestedSteps!.length} step{state.suggestedSteps!.length !== 1 ? 's' : ''}
          </p>
          <div className="space-y-1.5">
            {state.suggestedSteps!.map((step, i) => (
              <div key={step.id} className="flex items-start gap-2 text-xs text-slate-700">
                <span className="mt-0.5 shrink-0 rounded-full bg-[#1e3a8a] px-1.5 py-0.5 text-[10px] font-bold text-white">{i + 1}</span>
                <span>
                  <span className="font-semibold">{step.type}</span>
                  {Object.keys(step.config).length > 0 && (
                    <span className="ml-1 text-slate-400">
                      — {Object.entries(step.config).map(([k, v]) => `${k}: ${v}`).join(', ')}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 pt-1">These steps will be saved with the rule. You can refine them in the Rule Builder after saving.</p>
          <button
            type="button"
            onClick={() => update({ suggestedSteps: null })}
            className="text-xs text-slate-400 underline hover:text-slate-600"
          >
            Clear suggestion
          </button>
        </div>
      )}

      {!hasSuggestion && state.notes.trim() && !loading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
          Rule will be saved as a draft with no steps. You can add steps manually in the Rule Builder after saving.
        </div>
      )}
    </div>
  );
}

// ─── Tableau Copy Config ──────────────────────────────────────────────────────

const START_CELL_RE = /^[A-Za-z]+[1-9][0-9]*$/;

function TableauCopyConfig({
  state, update,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
}) {
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);

  const handleValidate = async () => {
    if (!state.tableauUrl.trim()) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await api.validateTableauUrl(state.tableauUrl.trim());
      setValidationResult(result);
      if (result.valid && result.view) {
        update({
          tableauViewName: result.view,
          tableauTargetSheet: state.tableauTargetSheet || result.view,
          tableauUrlValidated: true,
        });
      } else {
        update({ tableauUrlValidated: !result.valid ? false : null });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Validation request failed';
      setValidationResult({ valid: false, error: msg });
      update({ tableauUrlValidated: false });
    } finally {
      setValidating(false);
    }
  };

  const startCellInvalid =
    state.tableauMode === 'target_range' &&
    state.tableauStartCell.trim().length > 0 &&
    !START_CELL_RE.test(state.tableauStartCell.trim());

  return (
    <div className="space-y-5">
      {/* URL */}
      <div>
        <label className="block text-sm font-semibold text-slate-700">Tableau View URL *</label>
        <p className="mt-0.5 text-xs text-slate-500">
          Paste the full Tableau URL. Must be from{' '}
          <span className="font-mono">dub01.online.tableau.com</span>, site{' '}
          <span className="font-mono">logivice</span>.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="url"
            value={state.tableauUrl}
            onChange={e => {
              update({ tableauUrl: e.target.value, referenceUrl: e.target.value, tableauUrlValidated: null });
              setValidationResult(null);
            }}
            placeholder="https://dub01.online.tableau.com/#/site/logivice/views/WorkbookName/ViewName"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
          />
          <button
            type="button"
            onClick={handleValidate}
            disabled={!state.tableauUrl.trim() || validating}
            className="rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-40"
          >
            {validating ? 'Checking…' : 'Validate'}
          </button>
        </div>
      </div>

      {validationResult && (
        <div className={`rounded-lg border p-3 text-sm ${
          !validationResult.valid
            ? 'border-red-200 bg-red-50 text-red-700'
            : validationResult.viewFound
              ? 'border-green-200 bg-green-50'
              : 'border-amber-200 bg-amber-50'
        }`}>
          {!validationResult.valid && (
            <p className="text-sm text-red-700">{validationResult.error}</p>
          )}
          {validationResult.valid && validationResult.viewFound && (
            <>
              <p className="font-semibold text-green-800">✓ View confirmed in Tableau</p>
              <p className="mt-1 text-xs text-green-700">
                Workbook: <span className="font-mono">{validationResult.workbook}</span> · View: <span className="font-mono">{validationResult.view}</span>
              </p>
              {validationResult.rowCount !== undefined && (
                <p className="text-xs text-green-700">
                  {validationResult.rowCount} rows · {validationResult.columns?.length} columns
                  {validationResult.columns?.length > 0 && `: ${validationResult.columns.slice(0, 4).join(', ')}${validationResult.columns.length > 4 ? ` +${validationResult.columns.length - 4} more` : ''}`}
                </p>
              )}
            </>
          )}
          {validationResult.valid && !validationResult.viewFound && (
            <>
              <p className="font-semibold text-amber-800">URL format valid</p>
              <p className="mt-1 text-xs text-amber-700">{validationResult.warning ?? 'View could not be confirmed via Tableau API.'}</p>
            </>
          )}
        </div>
      )}

      {/* Mode selector */}
      <div>
        <p className="text-sm font-semibold text-slate-700">Where should the data go?</p>
        <div className="mt-2 space-y-2">
          {[
            {
              value: 'raw_sheet' as const,
              label: 'New sheet',
              desc: 'Append a fresh sheet to the generated workbook with all Tableau rows',
            },
            {
              value: 'target_range' as const,
              label: 'Existing template sheet / start cell',
              desc: 'Write the data into a specific sheet and cell in the uploaded template, preserving all formatting',
            },
          ].map(opt => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                state.tableauMode === opt.value
                  ? 'border-[#1e3a8a] bg-[#1e3a8a]/5'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="tableauMode"
                checked={state.tableauMode === opt.value}
                onChange={() => update({ tableauMode: opt.value })}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Raw sheet: sheet name */}
      {state.tableauMode === 'raw_sheet' && (
        <div>
          <label className="block text-sm font-semibold text-slate-700">New sheet name *</label>
          <input
            type="text"
            value={state.tableauTargetSheet}
            onChange={e => update({ tableauTargetSheet: e.target.value })}
            placeholder={state.tableauViewName || 'Tableau Data'}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
          />
          <p className="mt-1 text-xs text-slate-500">
            A new sheet with this name is added to the generated Excel file.
          </p>
        </div>
      )}

      {/* Target range: sheet name + start cell + headers + warning */}
      {state.tableauMode === 'target_range' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700">Existing template sheet name *</label>
            <input
              type="text"
              value={state.tableauTargetSheet}
              onChange={e => update({ tableauTargetSheet: e.target.value })}
              placeholder="e.g., Total"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20"
            />
            <p className="mt-1 text-xs text-slate-500">
              Must match the sheet name in the uploaded Excel template exactly.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700">Start cell *</label>
            <input
              type="text"
              value={state.tableauStartCell}
              onChange={e => update({ tableauStartCell: e.target.value.trim() })}
              placeholder="e.g., A10"
              className={`mt-1 w-40 rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 ${
                startCellInvalid
                  ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
                  : 'border-slate-300 focus:border-[#1e3a8a] focus:ring-[#1e3a8a]/20'
              }`}
            />
            {startCellInvalid && (
              <p className="mt-1 text-xs text-red-600">
                Must be a valid cell reference like A10 or BC5 — letter(s) then row number (no zero row).
              </p>
            )}
            {!startCellInvalid && (
              <p className="mt-1 text-xs text-slate-500">
                The top-left cell where the data will be written (e.g., A10).
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="tableauIncludeHeaders"
              checked={state.tableauIncludeHeaders}
              onChange={e => update({ tableauIncludeHeaders: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 accent-[#1e3a8a]"
            />
            <label htmlFor="tableauIncludeHeaders" className="text-sm text-slate-700">
              Include column headers as the first written row
            </label>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <span className="font-semibold">Note:</span> Existing cell values in the target range will be overwritten. Formatting and cells outside the written range are preserved.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step: Review ─────────────────────────────────────────────────────────────

function ReviewStep({
  state, update, customerId, existingRule,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  customerId: string;
  existingRule?: CustomerRuleDefinition;
}) {
  const summary = describeRule(state, customerId);
  const isNew = !existingRule?.id;
  const canToggleEnable = !isNew && existingRule?.approval_status === 'approved';

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold text-slate-900">Ready to save?</h3>
        <p className="mt-1 text-sm text-slate-500">Here's what this rule will do. Go back to change anything.</p>
      </div>

      {/* Plain-English summary */}
      <div className="rounded-xl bg-slate-50 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Rule summary</p>
        <p className="text-sm leading-relaxed text-slate-700">{summary}</p>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Rule name</p>
          <p className="mt-1 font-medium text-slate-800">{state.ruleName}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Customer</p>
          <p className="mt-1 font-medium text-slate-800">{customerId}</p>
        </div>
        {state.notes && (
          <div className="col-span-2 rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Notes</p>
            <p className="mt-1 text-slate-700">{state.notes}</p>
          </div>
        )}
        {state.referenceUrl && (
          <div className="col-span-2 rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Reference link</p>
            <a
              href={state.referenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block truncate text-[#1e3a8a] underline hover:text-[#1f1d70]"
            >
              {state.referenceUrl}
            </a>
          </div>
        )}
      </div>

      {/* Lifecycle notice / enable toggle */}
      {canToggleEnable ? (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">Enable this rule?</p>
            <p className="text-xs text-slate-500">
              This rule is approved. Saving with no step changes keeps it approved — you can enable it now or later from the list.
            </p>
          </div>
          <button
            type="button"
            onClick={() => update({ enabled: !state.enabled })}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              state.enabled ? 'bg-[#58a967]' : 'bg-slate-300'
            }`}
            aria-label={state.enabled ? 'Disable rule' : 'Enable rule'}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              state.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      ) : isNew ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-700">This rule will be saved as Draft</p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            {(['Draft', 'Tested', 'Approved', 'Active'] as const).map((label, i, arr) => (
              <span key={label} className="flex items-center gap-2">
                <span className={label === 'Draft' ? 'font-bold text-slate-800' : 'text-slate-400'}>{label}</span>
                {i < arr.length - 1 && <span className="text-slate-300">→</span>}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            After saving, use <span className="font-semibold">Test</span> → <span className="font-semibold">Approve</span> → <span className="font-semibold">Enable</span> from the rules list.
          </p>
        </div>
      ) : existingRule?.approval_status === 'tested' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Saving changes to steps or logic resets this rule to Draft</p>
          <p className="mt-1 text-xs text-amber-700">
            It must be re-tested and approved before it can be enabled again.
            Changes to name or description only do not affect lifecycle status.
          </p>
        </div>
      ) : existingRule?.approval_status === 'approved' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Saving changes to steps or logic resets this rule to Draft and disables it</p>
          <p className="mt-1 text-xs text-amber-700">
            It must be re-tested and re-approved before it can be enabled again.
            Changes to name or description only do not affect lifecycle status.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-700">Changes saved — rule stays in Draft</p>
          <p className="mt-1 text-xs text-slate-400">
            After saving, use <span className="font-semibold">Test</span> → <span className="font-semibold">Approve</span> → <span className="font-semibold">Enable</span> from the rules list.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function describeRule(state: WizardState, customerId: string): string {
  const field = state.matchField === '__custom__' ? state.matchCustomField : state.matchField;
  const fieldLabel = TRANSACTION_FIELDS.find(f => f.value === field)?.label ?? field;
  const filterFieldLabel = TRANSACTION_FIELDS.find(f => f.value === state.filterField)?.label ?? state.filterField;
  const transformFieldLabel = TRANSACTION_FIELDS.find(f => f.value === state.transformField)?.label ?? state.transformField;
  const combineFieldLabel = TRANSACTION_FIELDS.find(f => f.value === state.combineField)?.label ?? state.combineField;

  switch (state.intent) {
    case 'match':
      return [
        `For ${customerId}: looks at the "${fieldLabel}" field in each transaction`,
        state.matchStyle === 'exact'
          ? 'and finds an exact match in the invoice lines.'
          : `and finds a flexible match (${thresholdLabel(state.matchThreshold)} similarity) in the invoice lines.`,
        state.matchConflict === 'first_match'
          ? 'When more than one line fits, it will use the first one.'
          : 'When more than one line fits, the transaction is flagged for manual review.',
      ].join(' ');

    case 'filter':
      return state.filterAction === 'include'
        ? `For ${customerId}: only processes transactions where "${filterFieldLabel}" ${operatorLabel(state.filterOperator)} "${state.filterValue}". All other transactions are skipped.`
        : `For ${customerId}: skips any transaction where "${filterFieldLabel}" ${operatorLabel(state.filterOperator)} "${state.filterValue}". All other transactions are processed normally.`;

    case 'transform':
      return `For ${customerId}: before matching, the "${transformFieldLabel}" field is automatically ${transformLabel(state.transformOperation)} so it can be compared more accurately.`;

    case 'combine':
      return `For ${customerId}: groups transactions by "${combineFieldLabel}" and ${combineLabel(state.combineOperation)}.`;

    case 'other':
      if (state.suggestedSteps && state.suggestedSteps.length > 0) {
        return `For ${customerId}: custom rule with ${state.suggestedSteps.length} AI-suggested step${state.suggestedSteps.length !== 1 ? 's' : ''}. ${state.notes ? state.notes : ''}`.trim();
      }
      return state.notes
        ? `For ${customerId}: custom rule — ${state.notes}`
        : `For ${customerId}: custom rule — steps to be defined manually in the Rule Builder.`;

    case 'tableau_copy':
      if (state.tableauMode === 'target_range') {
        return `For ${customerId}: fetches Tableau view "${state.tableauViewName || state.tableauUrl}" and writes it into sheet "${state.tableauTargetSheet}" starting at cell ${state.tableauStartCell || 'A1'}${state.tableauIncludeHeaders ? ' (with headers)' : ' (no headers)'}.`;
      }
      return `For ${customerId}: copies Tableau view "${state.tableauViewName || state.tableauUrl}" into the generated workbook as a new sheet named "${state.tableauTargetSheet || state.tableauViewName || 'Tableau Data'}".`;

    default:
      return 'No purpose selected.';
  }
}

function thresholdLabel(t: number) {
  return t <= 0.5 ? 'low' : t <= 0.7 ? 'medium' : 'high';
}

function operatorLabel(op: string) {
  return ({ equals: 'is', not_equals: 'is not', contains: 'contains', gt: 'is greater than', lt: 'is less than' } as Record<string, string>)[op] ?? op;
}

function transformLabel(op: string) {
  return ({ uppercase: 'converted to ALL CAPS', lowercase: 'converted to lowercase', trim: 'trimmed of extra spaces', parse_date: 'parsed as a date' } as Record<string, string>)[op] ?? op;
}

function combineLabel(op: string) {
  return ({ sum: 'the quantities are added up', count: 'the number of rows is counted', deduplicate: 'duplicates are removed, keeping one row each' } as Record<string, string>)[op] ?? op;
}

function isConfigValid(state: WizardState): boolean {
  const field = state.matchField === '__custom__' ? state.matchCustomField : state.matchField;
  switch (state.intent) {
    case 'match':     return field.trim().length > 0;
    case 'filter':    return state.filterField.trim().length > 0 && state.filterValue.trim().length > 0;
    case 'transform': return state.transformField.trim().length > 0;
    case 'combine':   return state.combineField.trim().length > 0;
    case 'other':        return true;
    case 'tableau_copy': {
      if (!state.tableauUrl.trim()) return false;
      if (!state.tableauTargetSheet.trim()) return false;
      if (state.tableauMode === 'target_range') {
        const cell = state.tableauStartCell.trim();
        return cell.length > 0 && START_CELL_RE.test(cell);
      }
      return true;
    }
    default:             return false;
  }
}

// ─── Wizard ↔ Rule converters ─────────────────────────────────────────────────

function wizardToRule(
  state: WizardState,
  customerId: string,
  existingRule?: CustomerRuleDefinition,
): Partial<CustomerRuleDefinition> {
  const field = state.matchField === '__custom__' ? state.matchCustomField : state.matchField;
  const t = Date.now();

  let steps: RuleStep[] = [];
  let ruleType: CustomerRuleDefinition['ruleType'] = 'matching';

  switch (state.intent) {
    case 'match':
      ruleType = 'matching';
      steps = [
        { id: `step_${t}_1`, type: 'field_extraction',  enabled: true, config: { fieldName: field, outputKey: field } },
        {
          id: `step_${t}_2`,
          type: state.matchStyle === 'exact' ? 'match_transaction' : 'fuzzy_match',
          enabled: true,
          config: state.matchStyle === 'exact'
            ? { matchFields: [field], conflictResolution: state.matchConflict }
            : { matchFields: [field], threshold: state.matchThreshold },
        },
      ];
      break;

    case 'filter':
      ruleType = 'matching';
      steps = [{
        id: `step_${t}`,
        type: 'filter',
        enabled: true,
        config: {
          field: state.filterField,
          operator: state.filterOperator,
          value: state.filterValue,
          action: state.filterAction,
        },
      }];
      break;

    case 'transform':
      ruleType = 'transformation';
      steps = [{
        id: `step_${t}`,
        type: 'field_extraction',
        enabled: true,
        config: { fieldName: state.transformField, outputKey: state.transformField, transformType: state.transformOperation },
      }];
      break;

    case 'combine':
      ruleType = 'aggregation';
      steps = [{
        id: `step_${t}`,
        type: 'aggregate',
        enabled: true,
        config: { groupBy: state.combineField, operation: state.combineOperation },
      }];
      break;

    case 'other':
      ruleType = 'matching';
      steps = state.suggestedSteps ?? [];
      break;

    case 'tableau_copy':
      ruleType = 'matching';
      steps = [{
        id: `step_${t}`,
        type: 'tableau_table_copy' as any,
        enabled: true,
        config: {
          url: state.tableauUrl,
          viewName: state.tableauViewName || state.tableauUrl,
          mode: state.tableauMode,
          targetSheet: state.tableauTargetSheet || state.tableauViewName || 'Tableau Data',
          ...(state.tableauMode === 'target_range' ? { startCell: state.tableauStartCell.trim().toUpperCase() } : {}),
          includeHeaders: state.tableauIncludeHeaders,
        },
      }];
      break;
  }

  const description = [
    state.notes,
    state.referenceUrl ? `Reference: ${state.referenceUrl}` : '',
  ].filter(Boolean).join('\n\n');

  return {
    ...(existingRule ?? {}),
    customer_id: customerId,
    name: state.ruleName,
    description,
    ruleType,
    version: (existingRule?.version ?? 0) + 1,
    enabled: state.enabled,
    steps,
    created_by: existingRule?.created_by ?? 'admin',
    updated_by: 'admin',
  };
}

function ruleToWizard(rule: CustomerRuleDefinition): WizardState {
  const base: WizardState = {
    ...DEFAULT_STATE,
    ruleName: rule.name,
    enabled: rule.enabled,
  };

  // Parse description — split off reference URL if stored there
  const descParts = (rule.description ?? '').split('\n\nReference: ');
  base.notes = descParts[0] ?? '';
  base.referenceUrl = descParts[1] ?? '';

  const s0 = rule.steps[0];
  const s1 = rule.steps[1];
  if (!s0) {
    base.intent = 'other';
    return base;
  }

  if (s0.type === 'field_extraction' && s1) {
    const f = s0.config.fieldName ?? '';
    const isKnown = TRANSACTION_FIELDS.some(tf => tf.value === f);
    base.matchField = isKnown ? f : '__custom__';
    base.matchCustomField = isKnown ? '' : f;
    base.intent = 'match';
    if (s1.type === 'match_transaction') {
      base.matchStyle = 'exact';
      base.matchConflict = s1.config.conflictResolution ?? 'first_match';
    } else if (s1.type === 'fuzzy_match') {
      base.matchStyle = 'flexible';
      base.matchThreshold = s1.config.threshold ?? 0.7;
    }
  } else if (s0.type === 'field_extraction' && !s1) {
    base.intent = 'transform';
    base.transformField = s0.config.fieldName ?? '';
    base.transformOperation = s0.config.transformType ?? 'uppercase';
  } else if (s0.type === 'filter') {
    base.intent = 'filter';
    base.filterField = s0.config.field ?? '';
    base.filterOperator = s0.config.operator ?? 'equals';
    base.filterValue = s0.config.value ?? '';
    base.filterAction = s0.config.action ?? 'include';
  } else if (s0.type === 'aggregate') {
    base.intent = 'combine';
    base.combineField = s0.config.groupBy ?? '';
    base.combineOperation = s0.config.operation ?? 'sum';
  } else if (s0.type === 'tableau_table_copy') {
    base.intent = 'tableau_copy';
    base.tableauUrl = s0.config.url ?? '';
    base.tableauViewName = s0.config.viewName ?? '';
    base.tableauTargetSheet = s0.config.targetSheet ?? '';
    base.tableauMode = s0.config.mode === 'target_range' ? 'target_range' : 'raw_sheet';
    base.tableauStartCell = s0.config.startCell ?? '';
    base.tableauIncludeHeaders = s0.config.includeHeaders !== false;
    base.tableauUrlValidated = null;
    // Keep Step 1 and Step 3 in sync — if no reference URL was stored in the description,
    // use the Tableau URL from the step config so both fields show the same value.
    if (!base.referenceUrl && base.tableauUrl) {
      base.referenceUrl = base.tableauUrl;
    }
  } else {
    base.intent = 'other';
  }

  return base;
}
