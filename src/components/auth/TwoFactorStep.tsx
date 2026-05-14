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
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #0c1d4e 0%, #1e3a8a 60%, #1d62a8 100%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-3xl font-extrabold text-white tracking-tight">Logivice</div>
          <p className="mt-1.5 text-white/60 text-sm">Unilog SC · Invoice Processor</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="mb-6 text-center">
            <div className="text-lg font-semibold text-slate-900">Two-Factor Auth</div>
            <p className="mt-1 text-sm text-slate-500">Enter the 6-digit code from your authenticator app, or a backup code.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Authentication code</label>
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
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-center tracking-widest font-mono focus:border-[#1e3a8a] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20 transition"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-all hover:shadow-md active:scale-[0.99]"
              style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)' }}
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>

            <button
              type="button"
              onClick={onBack}
              className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition"
            >
              Back to login
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
