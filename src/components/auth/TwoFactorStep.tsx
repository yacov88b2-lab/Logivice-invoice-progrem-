import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

interface Props {
  preToken: string;
  onBack: () => void;
}

export function TwoFactorStep({ preToken, onBack }: Props) {
  const { verify2FA } = useAuth();
  const [code, setCode]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verify2FA(preToken, code);
      // AuthContext sets user; App re-renders to main UI
    } catch (err) {
      setError(err instanceof Error ? err.message : '2FA verification failed');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white shadow-lg p-8">
        <div className="mb-7 text-center">
          <div className="text-2xl font-bold text-[#28258b]">Two-Factor Auth</div>
          <p className="mt-1 text-sm text-slate-500">Enter the 6-digit code from your authenticator app, or a backup code.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Authentication code</label>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9a-f]/gi, ''))}
              placeholder="123456"
              maxLength={10}
              required
              autoComplete="one-time-code"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-center tracking-widest font-mono focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
            />
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full rounded bg-[#28258b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>

          <button
            type="button"
            onClick={onBack}
            className="w-full rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Back to login
          </button>
        </form>
      </div>
    </div>
  );
}
