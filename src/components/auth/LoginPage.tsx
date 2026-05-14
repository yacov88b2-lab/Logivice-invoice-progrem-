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
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #28258b 0%, #5b21b6 60%, #7c3aed 100%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-3xl font-extrabold text-white tracking-tight">Logivice</div>
          <p className="mt-1.5 text-white/60 text-sm">Unilog SC · Invoice Processor</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-slate-900 text-lg font-semibold mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@unilog.company"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-[#28258b] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#28258b]/20 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-[#28258b] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#28258b]/20 transition"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-all hover:shadow-md active:scale-[0.99]"
              style={{ background: 'linear-gradient(135deg, #28258b 0%, #7c3aed 100%)' }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-400">
            Only @unilog.company accounts are permitted
          </p>
        </div>
      </div>
    </div>
  );
}
