import { useState, useEffect } from 'react';
import { api } from '../../api';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  user: 'User',
  viewer: 'Viewer',
};

interface InviteInfo {
  email: string;
  name: string | null;
  role: string;
  expires_at: string;
}

export function InviteAcceptPage({ token }: { token: string }) {
  const [info, setInfo]           = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone]           = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('Invalid invite link — no token provided.');
      return;
    }
    api.getInviteInfo(token)
      .then(setInfo)
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setSubmitError('Passwords do not match');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      await api.acceptInvite(token, password);
      setDone(true);
      setTimeout(() => { window.location.href = '/'; }, 2500);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #28258b 0%, #5b21b6 60%, #7c3aed 100%)' }}
    >
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="text-3xl font-extrabold text-white tracking-tight">Logivice</div>
          <p className="mt-1.5 text-white/60 text-sm">Unilog SC · Invoice Processor</p>
          <h1 className="text-xl font-semibold text-white mt-4">Set up your account</h1>
          <p className="text-sm text-white/60 mt-1">You've been invited to Unilog Invoice Control</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-md">
          {!token || loadError ? (
            <div className="text-center space-y-3">
              <div className="text-red-600 text-sm">{loadError || 'Invalid invite link.'}</div>
              <a href="/" className="text-sm text-[#28258b] hover:underline">Back to login</a>
            </div>
          ) : !info ? (
            <div className="text-center text-sm text-slate-500">Validating invite…</div>
          ) : done ? (
            <div className="text-center space-y-3">
              <div className="text-green-600 font-medium">Account created successfully!</div>
              <div className="text-sm text-slate-500">Redirecting to login…</div>
            </div>
          ) : (
            <>
              <div className="mb-5 rounded-md bg-slate-50 border border-slate-200 p-3 space-y-1">
                <div className="text-sm text-slate-700">
                  <span className="font-medium">Email:</span> {info.email}
                </div>
                {info.name && (
                  <div className="text-sm text-slate-700">
                    <span className="font-medium">Name:</span> {info.name}
                  </div>
                )}
                <div className="text-sm text-slate-700">
                  <span className="font-medium">Role:</span>{' '}
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {ROLE_LABEL[info.role] ?? info.role}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  Expires {new Date(info.expires_at).toLocaleString()}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Password <span className="text-slate-400 font-normal text-xs">(min 8 chars, 1 uppercase, 1 number)</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Confirm password</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
                  />
                </div>

                {submitError && <div className="text-sm text-red-600">{submitError}</div>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-all hover:shadow-md"
                  style={{ background: 'linear-gradient(135deg, #28258b 0%, #7c3aed 100%)' }}
                >
                  {submitting ? 'Creating account…' : 'Create account'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
