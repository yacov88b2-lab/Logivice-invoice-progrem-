import { useState, useRef } from 'react';
import { api } from '../../api';
import type { CustomerRuleDefinition, RuleStep } from './RuleBuilder';
import { toast } from '../../toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 'name' | 'intent' | 'configure' | 'review';
type RuleIntent = 'match' | 'filter' | 'transform' | 'combine';

interface WizardState {
  ruleName: string;
  notes: string;
  referenceUrl: string;
  intent: RuleIntent | null;
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
}

const DEFAULT_STATE: WizardState = {
  ruleName: '',
  notes: '',
  referenceUrl: '',
  intent: null,
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
              i === stepIndex ? 'bg-[#28258b] text-white' :
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
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {step === 'name'      && <NameStep      state={state} update={update} isListening={isListening} onToggleVoice={toggleVoice} />}
        {step === 'intent'    && <IntentStep    state={state} update={update} />}
        {step === 'configure' && <ConfigureStep state={state} update={update} />}
        {step === 'review'    && <ReviewStep    state={state} update={update} customerId={customerId} />}
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
          className="rounded bg-[#28258b] px-6 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-40"
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
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
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
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
        />
        {isListening && (
          <p className="mt-1 text-xs text-red-600">🔴 Listening… speak now. Click "Stop recording" when done.</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700">
          Reference link <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input
          type="url"
          value={state.referenceUrl}
          onChange={e => update({ referenceUrl: e.target.value })}
          placeholder="https://  — paste a link to a Tableau view, spreadsheet, or any reference"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
        />
        <p className="mt-1 text-xs text-slate-400">This is saved for reference only — it won't affect how the rule runs.</p>
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
            onClick={() => update({ intent: intent.id })}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              state.intent === intent.id
                ? 'border-[#28258b] bg-[#28258b]/5 shadow-sm'
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
  state, update,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
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
                  ? 'border-[#28258b] bg-[#28258b] text-white'
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
                ? 'border-[#28258b] bg-[#28258b] text-white'
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
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
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
                  ? 'border-[#28258b] bg-[#28258b]/5'
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
                    ? 'border-[#28258b] bg-[#28258b]/5 font-semibold text-[#28258b]'
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
                  ? 'border-[#28258b] bg-[#28258b]/5'
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
                  ? 'border-[#28258b] bg-[#28258b]/5'
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
                  ? 'border-[#28258b] bg-[#28258b] text-white'
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
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
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
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
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
                  ? 'border-[#28258b] bg-[#28258b] text-white'
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
                  ? 'border-[#28258b] bg-[#28258b]/5'
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
                  ? 'border-[#28258b] bg-[#28258b] text-white'
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
                  ? 'border-[#28258b] bg-[#28258b]/5'
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

// ─── Step: Review ─────────────────────────────────────────────────────────────

function ReviewStep({
  state, update, customerId,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  customerId: string;
}) {
  const summary = describeRule(state, customerId);

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
              className="mt-1 block truncate text-[#28258b] underline hover:text-[#1f1d70]"
            >
              {state.referenceUrl}
            </a>
          </div>
        )}
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">Activate this rule now?</p>
          <p className="text-xs text-slate-500">You can turn it on or off at any time from the rules list.</p>
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
    default:          return false;
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
  if (!s0) return base;

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
  }

  return base;
}
