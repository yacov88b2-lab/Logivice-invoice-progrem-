import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { TwoFactorStep } from './TwoFactorStep';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [preToken, setPreToken] = useState<string | null>(null);

  if (preToken) {
    return <TwoFactorStep preToken={preToken} onBack={() => setPreToken(null)} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.requiresTwoFactor && result.preToken) {
        setPreToken(result.preToken);
      }
      // if login succeeded without 2FA, AuthContext sets user and App re-renders
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white shadow-lg p-8">
        <div className="mb-7 text-center">
          <div className="text-2xl font-bold text-[#28258b] tracking-tight">Logivice</div>
          <p className="mt-1 text-sm text-slate-500">Invoice Processor — Sign in</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@unilog.company"
              required
              autoComplete="email"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
            />
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-[#28258b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Only @unilog.company accounts are permitted
        </p>
      </div>
    </div>
  );
}
