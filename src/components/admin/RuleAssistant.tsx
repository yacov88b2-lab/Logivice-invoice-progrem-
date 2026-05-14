import { useState } from 'react';
import { api } from '../../api';

interface Props {
  customerId: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function RuleAssistant({ customerId, onSaved, onCancel }: Props) {
  const [description, setDescription] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [loadingSave, setLoadingSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ steps: unknown[]; explanation: string } | null>(null);

  const handleSuggest = async () => {
    if (description.trim().length < 5) return;
    try {
      setLoadingSuggest(true);
      setError(null);
      setResult(null);
      const data = await api.suggestRuleSteps(customerId, description.trim());
      setResult(data);
      if (!ruleName) setRuleName(`AI Rule — ${description.trim().slice(0, 40)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setError(
        msg.includes('503') || msg.toLowerCase().includes('service unavailable')
          ? 'Rule Assistant is currently unavailable. Use the manual wizard below.'
          : msg
      );
    } finally {
      setLoadingSuggest(false);
    }
  };

  const handleSave = async () => {
    if (!result || !ruleName.trim() || !customerId) return;
    try {
      setLoadingSave(true);
      setError(null);
      await api.createRule({
        customer_id: customerId,
        name: ruleName.trim(),
        description: result.explanation,
        ruleType: 'matching',
        steps: result.steps,
        created_by: 'assistant'
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setLoadingSave(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#58a967]">AI-Powered</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">Rule Assistant</h3>
          <p className="mt-1 text-sm text-slate-600">
            Describe how transactions should match pricelist rows. The assistant suggests rule steps, which you can save as a draft rule for QA review.
          </p>
        </div>
        <button type="button" onClick={onCancel}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
      </div>

      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        Customer: <span className="font-semibold text-slate-800">{customerId || '(none selected)'}</span>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">
          Describe the matching logic
        </label>
        <textarea
          rows={4}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={'e.g. "Match inbound transactions by segment and clause. Ignore the remark field. For outbound, also require category to match."'}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
        />
      </div>

      <button type="button" onClick={handleSuggest}
        disabled={loadingSuggest || description.trim().length < 5}
        className="rounded-lg bg-[#28258b] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:cursor-not-allowed disabled:opacity-50">
        {loadingSuggest ? 'Generating…' : 'Suggest rule steps'}
      </button>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-4 rounded border border-[#28258b]/20 bg-[#28258b]/5 p-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[#28258b]">Explanation</span>
            <p className="mt-1 text-sm text-slate-700">{result.explanation}</p>
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[#28258b]">
              Suggested steps ({(result.steps as unknown[]).length})
            </span>
            <div className="mt-2 space-y-2">
              {(result.steps as any[]).map((step, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <span className="mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#28258b] text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold text-slate-800 capitalize">{step.type.replace(/_/g, ' ')}</span>
                    {step.config && Object.keys(step.config).length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        {Object.entries(step.config as Record<string, unknown>).map(([k, v]) => (
                          <span key={k}>
                            <span className="text-slate-400">{k}: </span>
                            <span className="font-medium text-slate-600">{Array.isArray(v) ? v.join(', ') : String(v)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-[#28258b]/10 pt-4 space-y-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Rule name</label>
              <input
                type="text"
                value={ruleName}
                onChange={e => setRuleName(e.target.value)}
                placeholder="Name for this rule"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
              />
            </div>

            {/* Lifecycle notice */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-800">Saved as Draft — not active yet</p>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-amber-700">
                {['Save as Draft', 'Test it', 'Approve', 'Enable'].map((step, i, arr) => (
                  <span key={step} className="flex items-center gap-2">
                    <span className={i === 0 ? 'font-bold' : ''}>{step}</span>
                    {i < arr.length - 1 && <span className="text-amber-400">→</span>}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-xs text-amber-600">The rule won't affect invoices until it's been tested, approved, and enabled.</p>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={handleSave}
                disabled={loadingSave || !ruleName.trim() || !customerId}
                className="rounded bg-[#58a967] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#43864f] disabled:cursor-not-allowed disabled:opacity-50">
                {loadingSave ? 'Saving…' : 'Save as draft rule'}
              </button>
              <button type="button"
                onClick={() => { setResult(null); setDescription(''); setRuleName(''); }}
                className="rounded border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Start over
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
