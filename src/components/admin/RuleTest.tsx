import { useState } from 'react';
import { api } from '../../api';
import type { CustomerRuleDefinition } from './RuleBuilder';
import { toast } from '../../toast';

interface RuleTestProps {
  rule: CustomerRuleDefinition;
}

export function RuleTest({ rule }: RuleTestProps) {
  const [testData, setTestData] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const runTest = async () => {
    setLoading(true);
    try {
      const parsed = JSON.parse(testData);
      if (!rule.id) throw new Error('Rule must be saved before testing');
      const testResult = await api.testRule(rule.id, parsed);
      setResult(testResult);
    } catch (error) {
      toast.error(`Error running test: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 rounded border border-slate-200 bg-white p-5">
      <h3 className="text-lg font-semibold">Test Rule: {rule.name}</h3>

      <div>
        <label className="block text-sm font-medium">Test Data (JSON)</label>
        <textarea
          value={testData}
          onChange={e => setTestData(e.target.value)}
          className="mt-2 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
          rows={6}
          placeholder='{"transaction": {...}, "lineItems": [...]}'
        />
      </div>

      <button
        onClick={runTest}
        disabled={loading || !testData}
        className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? 'Testing...' : 'Run Test'}
      </button>

      {result && (
        <div className={`rounded p-4 ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className="font-mono text-sm">
            <div className="font-semibold">{result.success ? '✓ Success' : '✗ Failed'}</div>
            <pre className="mt-2 overflow-auto bg-white p-2 rounded border border-slate-200">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
