import { useState } from 'react';
import { api } from '../../api';
import type { CustomerRuleDefinition } from './RuleBuilder';
import { toast } from '../../toast';

interface RuleTestProps {
  rule: CustomerRuleDefinition;
  onMarkedTested?: () => void;
}

interface TxForm {
  segment: string;
  movementType: string;
  category: string;
  unitOfMeasure: string;
  description: string;
  quantity: string;
  orderNumber: string;
  date: string;
}

interface LIForm {
  segment: string;
  clause: string;
  category: string;
  unitOfMeasure: string;
  remark: string;
  rate: string;
}

const DEFAULT_TX: TxForm = {
  segment: '',
  movementType: '',
  category: '',
  unitOfMeasure: '',
  description: '',
  quantity: '1',
  orderNumber: '',
  date: new Date().toISOString().slice(0, 10),
};

const BLANK_LI: LIForm = { segment: '', clause: '', category: '', unitOfMeasure: '', remark: '', rate: '0' };

const TX_FIELDS: { label: string; key: keyof TxForm; type?: string }[] = [
  { label: 'Segment',         key: 'segment' },
  { label: 'Movement Type',   key: 'movementType' },
  { label: 'Category',        key: 'category' },
  { label: 'Unit of Measure', key: 'unitOfMeasure' },
  { label: 'Description',     key: 'description' },
  { label: 'Order Number',    key: 'orderNumber' },
  { label: 'Quantity',        key: 'quantity',  type: 'number' },
  { label: 'Date',            key: 'date',      type: 'date' },
];

// ── Result analysis helpers ───────────────────────────────────────────────────

interface MatchEntry { item: Record<string, any>; confidence: number; reason: string }

function analyseResult(result: any) {
  const errors: string[]     = result?.errors  ?? [];
  const warnings: string[]   = result?.warnings ?? [];
  const data: Record<string, any> = result?.data ?? {};

  // match_transaction / fuzzy_match steps put their output in data.matches / data.matchedLineItem
  const rawMatches: MatchEntry[] = data.matches ?? [];
  const unmatched: { reason: string }[] = data.unmatched ?? [];
  const hasMatchStep = 'matches' in data || 'unmatched' in data;
  const hasMatch     = rawMatches.length > 0;
  const hasErrors    = errors.length > 0;
  const isClean      = result?.success === true && !hasErrors;

  // Scalar extracted / transformed values (strip match keys from display)
  const extractedData = Object.fromEntries(
    Object.entries(data).filter(([k]) => !['matches', 'unmatched', 'matchedLineItem'].includes(k))
  );

  return { errors, warnings, rawMatches, unmatched, hasMatchStep, hasMatch, hasErrors, isClean, extractedData };
}

type BannerColor = 'green' | 'amber' | 'red';
interface Banner { label: string; color: BannerColor; icon: string; detail: string }

function buildBanner(result: any): Banner | null {
  if (!result) return null;
  const { hasErrors, isClean, hasMatchStep, hasMatch, errors, unmatched } = analyseResult(result);

  if (!isClean) {
    return {
      label: 'Rule has errors',
      color: 'red',
      icon: '✗',
      detail: hasErrors ? errors.join(' • ') : 'The rule encountered an unexpected error and did not finish.',
    };
  }
  if (hasMatchStep && !hasMatch) {
    const reason = unmatched[0]?.reason ?? 'No pricelist row matched this transaction.';
    return {
      label: 'No match found',
      color: 'amber',
      icon: '⚠',
      detail: `${reason} Adjust the test data or the rule steps and try again.`,
    };
  }
  if (hasMatchStep && hasMatch) {
    return {
      label: 'Matched',
      color: 'green',
      icon: '✓',
      detail: `${result.data.matches.length} pricelist row(s) matched this transaction.`,
    };
  }
  // No match step (filter / transform / extraction rule)
  return {
    label: 'Ran successfully',
    color: 'green',
    icon: '✓',
    detail: 'The rule ran without errors. No matching step — extracted values are shown below.',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Tableau copy test panel ───────────────────────────────────────────────────

function TableauCopyTestPanel({ rule, onMarkedTested }: RuleTestProps) {
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [markingTested, setMarkingTested] = useState(false);

  const step = rule.steps.find((s: any) => s.type === 'tableau_table_copy');
  const url: string = step?.config?.url ?? '';
  const targetSheet: string = step?.config?.targetSheet ?? 'Tableau Data';

  const runCheck = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await api.testRule(rule.id!, { transaction: {}, lineItems: [] });
      setResult(res);
    } catch (err) {
      toast.error(`Test failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkTested = async () => {
    setMarkingTested(true);
    try {
      await api.markRuleTested(rule.id!);
      toast.success('Marked as tested — an admin can now approve this rule.');
      onMarkedTested?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setMarkingTested(false);
    }
  };

  const tc = result?.data?.tableau_copy;
  const success = result?.success === true && tc?.valid;
  const canMarkTested = rule.approval_status === 'draft' && success;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Tableau view URL</p>
        <p className="mt-1 break-all font-mono text-sm text-[#28258b]">{url || '(none set)'}</p>
        <p className="mt-2 text-xs text-slate-500">
          Target sheet in output: <span className="font-semibold text-slate-700">{targetSheet}</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">Mode: raw sheet (Phase 1)</p>
      </div>

      <button
        type="button"
        onClick={runCheck}
        disabled={loading || !url}
        className="rounded-lg bg-[#28258b] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50"
      >
        {loading ? 'Checking Tableau…' : 'Validate URL & fetch sample data'}
      </button>

      {result && (
        <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${
            !tc?.valid ? 'border-red-200 bg-red-50' :
            tc?.viewFound ? 'border-green-200 bg-green-50' :
            'border-amber-200 bg-amber-50'
          }`}>
            {!tc?.valid && (
              <>
                <p className="font-semibold text-red-800">✗ Invalid URL</p>
                <p className="mt-1 text-sm text-red-700">{tc?.error}</p>
              </>
            )}
            {tc?.valid && tc?.viewFound && (
              <>
                <p className="font-semibold text-green-800">✓ View found in Tableau</p>
                <p className="mt-1 text-xs text-green-700">
                  Workbook: <span className="font-mono">{tc.workbook}</span> · View: <span className="font-mono">{tc.view}</span>
                </p>
                <p className="mt-0.5 text-xs text-green-700">
                  {tc.totalRows} rows · {tc.columns?.length} columns · target sheet: <span className="font-semibold">{tc.targetSheet}</span>
                </p>
              </>
            )}
            {tc?.valid && !tc?.viewFound && (
              <>
                <p className="font-semibold text-amber-800">⚠ URL valid — view not confirmed</p>
                <p className="mt-1 text-xs text-amber-700">{tc?.warning}</p>
              </>
            )}
          </div>

          {tc?.viewFound && tc?.columns?.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Sample data ({tc.sampleRows?.length ?? 0} of {tc.totalRows} rows)
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {tc.columns.slice(0, 6).map((col: string) => (
                        <th key={col} className="border border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold text-slate-700">
                          {col}
                        </th>
                      ))}
                      {tc.columns.length > 6 && <th className="border border-slate-200 bg-slate-100 px-2 py-1 text-slate-400">+{tc.columns.length - 6} more</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(tc.sampleRows ?? []).map((row: string[], i: number) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {row.slice(0, 6).map((cell: string, j: number) => (
                          <td key={j} className="border border-slate-200 px-2 py-1 text-slate-700">{cell}</td>
                        ))}
                        {row.length > 6 && <td className="border border-slate-200 px-2 py-1 text-slate-400">…</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {canMarkTested && (
            <div className="rounded-xl border border-[#28258b]/20 bg-[#28258b]/5 p-4">
              <p className="text-sm font-semibold text-slate-800">Ready to mark as tested?</p>
              <p className="mt-0.5 text-xs text-slate-500">
                URL is valid and view was found. Marking tested unlocks the Approve action.
              </p>
              <button
                type="button"
                onClick={handleMarkTested}
                disabled={markingTested}
                className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {markingTested ? 'Saving…' : 'Mark as Tested'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main test component ───────────────────────────────────────────────────────

export function RuleTest({ rule, onMarkedTested }: RuleTestProps) {
  // Route tableau_table_copy rules to their own panel
  if (rule.steps.some((s: any) => s.type === 'tableau_table_copy')) {
    return <TableauCopyTestPanel rule={rule} onMarkedTested={onMarkedTested} />;
  }

  const [tx, setTx] = useState<TxForm>({ ...DEFAULT_TX });
  const [lineItems, setLineItems] = useState<LIForm[]>([{ ...BLANK_LI }]);
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [markingTested, setMarkingTested] = useState(false);

  const updateTx = (patch: Partial<TxForm>) => setTx(s => ({ ...s, ...patch }));
  const updateLI  = (i: number, patch: Partial<LIForm>) =>
    setLineItems(items => items.map((li, idx) => idx === i ? { ...li, ...patch } : li));

  const runTest = async () => {
    setLoading(true);
    setResult(null);
    try {
      if (!rule.id) throw new Error('Rule must be saved before testing');
      const testData = {
        transaction: {
          id: `test_${Date.now()}`,
          date: tx.date,
          segment: tx.segment,
          movementType: tx.movementType,
          category: tx.category,
          unitOfMeasure: tx.unitOfMeasure,
          description: tx.description,
          quantity: parseFloat(tx.quantity) || 0,
          orderNumber: tx.orderNumber,
          customer: rule.customer_id,
          warehouse: '',
        },
        lineItems: lineItems
          .filter(li => li.segment || li.clause || li.category)
          .map((li, idx) => ({
            row: idx + 1,
            segment: li.segment,
            clause: li.clause,
            category: li.category,
            unitOfMeasure: li.unitOfMeasure,
            remark: li.remark,
            rate: parseFloat(li.rate) || 0,
            qty: null,
            total: 0,
          })),
      };
      const res = await api.testRule(rule.id, testData);
      setResult(res);
    } catch (err) {
      toast.error(`Test failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkTested = async () => {
    setMarkingTested(true);
    try {
      await api.markRuleTested(rule.id!);
      toast.success('Marked as tested — an admin can now approve this rule.');
      onMarkedTested?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setMarkingTested(false);
    }
  };

  const banner = buildBanner(result);
  const { rawMatches, hasMatchStep, hasMatch, hasErrors, isClean, extractedData, warnings } =
    result ? analyseResult(result) : { rawMatches: [], hasMatchStep: false, hasMatch: false, hasErrors: false, isClean: false, extractedData: {}, warnings: [] };

  // Only allow marking tested when:
  // - Rule is still in draft
  // - No errors
  // - If it has a match step: a real match was found
  // - If no match step: ran cleanly
  const canMarkTested =
    rule.approval_status === 'draft' &&
    isClean &&
    (hasMatchStep ? hasMatch : true);

  const bannerBg = (c: BannerColor) =>
    ({ green: 'border-green-200 bg-green-50', amber: 'border-amber-200 bg-amber-50', red: 'border-red-200 bg-red-50' }[c]);
  const bannerTitle = (c: BannerColor) =>
    ({ green: 'text-green-800', amber: 'text-amber-800', red: 'text-red-800' }[c]);
  const bannerBody = (c: BannerColor) =>
    ({ green: 'text-green-700', amber: 'text-amber-700', red: 'text-red-700' }[c]);

  return (
    <div className="space-y-6">

      {/* ── Transaction form ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Sample transaction</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          Fill in the fields this rule cares about. Leave others blank.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TX_FIELDS.map(({ label, key, type }) => (
            <div key={key} className={key === 'description' ? 'col-span-2' : ''}>
              <label className="block text-xs font-semibold text-slate-600">{label}</label>
              <input
                type={type ?? 'text'}
                value={tx[key]}
                onChange={e => updateTx({ [key]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm
                  focus:border-[#28258b] focus:outline-none focus:ring-1 focus:ring-[#28258b]/20"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Pricelist rows ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Pricelist rows to match against</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Add the rows you expect this transaction to hit. Leave all blank to test extraction or filter steps only.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLineItems(items => [...items, { ...BLANK_LI }])}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            + Add row
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-6 gap-2 px-0.5">
            {['Segment', 'Clause', 'Category', 'UoM', 'Remark', 'Rate'].map(h => (
              <span key={h} className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{h}</span>
            ))}
          </div>

          {lineItems.map((li, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 items-center">
              {(['segment', 'clause', 'category', 'unitOfMeasure', 'remark'] as const).map(key => (
                <input
                  key={key}
                  type="text"
                  value={li[key]}
                  onChange={e => updateLI(i, { [key]: e.target.value })}
                  className="rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-[#28258b] focus:outline-none"
                />
              ))}
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={li.rate}
                  onChange={e => updateLI(i, { rate: e.target.value })}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-[#28258b] focus:outline-none"
                />
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLineItems(items => items.filter((_, idx) => idx !== i))}
                    className="shrink-0 text-slate-300 hover:text-red-500"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Run button ── */}
      <button
        type="button"
        onClick={runTest}
        disabled={loading}
        className="rounded-lg bg-[#28258b] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50"
      >
        {loading ? 'Running test…' : 'Run test'}
      </button>

      {/* ── Results ── */}
      {result && banner && (
        <div className="space-y-4">

          {/* Summary banner */}
          <div className={`rounded-xl border p-4 ${bannerBg(banner.color)}`}>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-bold ${bannerTitle(banner.color)}`}>{banner.icon}</span>
              <span className={`font-semibold ${bannerTitle(banner.color)}`}>{banner.label}</span>
            </div>
            <p className={`mt-1 text-sm ${bannerBody(banner.color)}`}>{banner.detail}</p>
          </div>

          {/* Matched items — data.matches[].item */}
          {hasMatch && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Matched pricelist rows
              </p>
              <div className="mt-2 space-y-2">
                {rawMatches.map((m, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 px-3 py-2.5">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {m.item.segment   && <span><span className="text-xs text-slate-400">Segment </span><span className="font-semibold">{m.item.segment}</span></span>}
                      {m.item.clause    && <span><span className="text-xs text-slate-400">Clause </span><span className="font-semibold">{m.item.clause}</span></span>}
                      {m.item.category  && <span><span className="text-xs text-slate-400">Category </span><span className="font-semibold">{m.item.category}</span></span>}
                      {m.item.unitOfMeasure && <span><span className="text-xs text-slate-400">UoM </span><span className="font-semibold">{m.item.unitOfMeasure}</span></span>}
                      {m.item.remark    && <span><span className="text-xs text-slate-400">Remark </span><span className="font-semibold">{m.item.remark}</span></span>}
                      {m.item.rate != null && <span><span className="text-xs text-slate-400">Rate </span><span className="font-semibold">${Number(m.item.rate).toFixed(2)}</span></span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                      <span>{m.reason}</span>
                      {m.confidence != null && (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600">
                          {Math.round(m.confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Extracted / transformed data (scalar keys only) */}
          {Object.keys(extractedData).length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Extracted values</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(extractedData).map(([k, v]) => (
                  <span key={k} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs">
                    <span className="text-slate-500">{k}: </span>
                    <span className="font-semibold text-slate-800">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Steps that ran */}
          {result.executedSteps?.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Steps executed ({result.executedSteps.length})
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(result.executedSteps as string[]).map((s, i) => (
                  <span key={i} className="rounded-full bg-[#28258b]/10 px-2.5 py-0.5 text-xs font-semibold text-[#28258b]">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-500">Warnings</p>
              <ul className="mt-1 space-y-0.5">
                {warnings.map((w, i) => <li key={i} className="text-sm text-amber-700">{w}</li>)}
              </ul>
            </div>
          )}

          {/* Errors */}
          {hasErrors && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-400">Errors</p>
              <ul className="mt-1 space-y-0.5">
                {(result.errors as string[]).map((e, i) => (
                  <li key={i} className="text-sm text-red-700">{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Mark as Tested — only after a real successful run */}
          {canMarkTested && (
            <div className="rounded-xl border border-[#28258b]/20 bg-[#28258b]/5 p-4">
              <p className="text-sm font-semibold text-slate-800">Ready to mark as tested?</p>
              <p className="mt-0.5 text-xs text-slate-500">
                This unlocks the Approve action. The rule still won't affect invoices until it's approved and enabled.
              </p>
              <button
                type="button"
                onClick={handleMarkTested}
                disabled={markingTested}
                className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {markingTested ? 'Saving…' : 'Mark as Tested'}
              </button>
            </div>
          )}

          {/* Contextual hint when matched but not markable */}
          {result && !canMarkTested && isClean && hasMatchStep && !hasMatch && (
            <p className="text-xs text-slate-400">
              Fix the rule or test data so a match is found before marking as tested.
            </p>
          )}
          {result && !canMarkTested && rule.approval_status !== 'draft' && isClean && (
            <p className="text-xs text-slate-400">
              Rule is already at <span className="font-semibold capitalize">{rule.approval_status}</span> — no need to mark as tested again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
