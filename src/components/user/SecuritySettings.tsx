import { useState, useEffect } from 'react';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';

export function SecuritySettings() {
  const { user, refreshUser } = useAuth();
  const [status, setStatus]     = useState<{ enabled: boolean; backupCodesRemaining: number } | null>(null);
  const [loading, setLoading]   = useState(true);

  const [panel, setPanel] = useState<
    | null
    | 'setup'
    | 'confirm'
    | 'disable'
    | 'backup-codes'
    | 'change-password'
  >(null);

  const loadStatus = async () => {
    try {
      setLoading(true);
      setStatus(await api.get2FAStatus());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading security settings…</div>;

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold text-slate-900">Security Settings</h2>

      {/* Password */}
      <section className="rounded-lg border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-800">Password</div>
            <div className="text-xs text-slate-500">Change your account password</div>
          </div>
          <button
            onClick={() => setPanel('change-password')}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
          >
            Change
          </button>
        </div>
      </section>

      {/* 2FA */}
      <section className="rounded-lg border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-800">Two-factor authentication</div>
            <div className="text-xs text-slate-500">
              {status?.enabled
                ? `Enabled — ${status.backupCodesRemaining} backup code${status.backupCodesRemaining === 1 ? '' : 's'} remaining`
                : 'Not enabled'}
            </div>
          </div>
          {status?.enabled ? (
            <div className="flex gap-2">
              <button
                onClick={() => setPanel('backup-codes')}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
              >
                Backup codes
              </button>
              <button
                onClick={() => setPanel('disable')}
                className="rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Disable
              </button>
            </div>
          ) : (
            <button
              onClick={() => setPanel('setup')}
              className="rounded bg-[#28258b] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1f1d70]"
            >
              Enable 2FA
            </button>
          )}
        </div>
      </section>

      {/* Account info */}
      <section className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500 space-y-1">
        <div><span className="font-medium text-slate-700">Email:</span> {user?.email}</div>
        <div><span className="font-medium text-slate-700">Role:</span> {user?.role}</div>
        <div><span className="font-medium text-slate-700">Last login:</span> {user?.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'N/A'}</div>
      </section>

      {/* Panels */}
      {panel === 'setup' && (
        <Setup2FAPanel onClose={() => setPanel(null)} onSetupDone={() => { setPanel('confirm'); loadStatus(); }} />
      )}
      {panel === 'confirm' && (
        <Confirm2FAPanel onClose={() => { setPanel(null); loadStatus(); refreshUser(); }} />
      )}
      {panel === 'disable' && (
        <Disable2FAPanel onClose={() => { setPanel(null); loadStatus(); }} />
      )}
      {panel === 'backup-codes' && (
        <BackupCodesPanel onClose={() => { setPanel(null); loadStatus(); }} />
      )}
      {panel === 'change-password' && (
        <ChangePasswordPanel onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

// ── Setup 2FA ─────────────────────────────────────────────────────────────────

function Setup2FAPanel({ onClose, onSetupDone }: { onClose: () => void; onSetupDone: () => void }) {
  const [data, setData]   = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.setup2FA()
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to start setup'));
  }, []);

  if (error) return <Modal title="Enable 2FA" onClose={onClose}><p className="text-sm text-red-600">{error}</p></Modal>;
  if (!data)  return <Modal title="Enable 2FA" onClose={onClose}><p className="text-sm text-slate-500">Loading…</p></Modal>;

  return (
    <Modal title="Enable Two-Factor Authentication" onClose={onClose}>
      <p className="text-sm text-slate-600">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then click Continue.</p>
      <img src={data.qrCodeDataUrl} alt="QR code" className="w-40 h-40 mx-auto rounded border border-slate-200" />
      <p className="text-xs text-slate-500 text-center">Manual entry key: <span className="font-mono bg-slate-100 px-1 rounded">{data.secret}</span></p>
      <div className="flex gap-2">
        <button onClick={onSetupDone} className="flex-1 rounded bg-[#28258b] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70]">Continue</button>
        <button onClick={onClose} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Cancel</button>
      </div>
    </Modal>
  );
}

// ── Confirm 2FA ───────────────────────────────────────────────────────────────

function Confirm2FAPanel({ onClose }: { onClose: () => void }) {
  const [code, setCode]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.confirm2FA(code);
      setBackupCodes(res.backupCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  if (backupCodes) {
    return (
      <Modal title="Save your backup codes" onClose={onClose}>
        <p className="text-sm text-slate-600">Store these somewhere safe. Each code can be used once if you lose access to your authenticator app.</p>
        <div className="grid grid-cols-2 gap-1.5 font-mono text-sm bg-slate-50 rounded p-3 border border-slate-200">
          {backupCodes.map(c => <span key={c} className="text-center">{c}</span>)}
        </div>
        <button onClick={onClose} className="w-full rounded bg-[#28258b] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70]">
          Done — I've saved my codes
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Confirm 2FA setup" onClose={onClose}>
      <p className="text-sm text-slate-600">Enter the 6-digit code from your authenticator app to confirm setup.</p>
      <form onSubmit={handleConfirm} className="space-y-3">
        <input
          type="text"
          inputMode="numeric"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          maxLength={6}
          required
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-center tracking-widest font-mono focus:border-[#28258b] focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={loading || code.length < 6} className="flex-1 rounded bg-[#28258b] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50">
            {loading ? 'Verifying…' : 'Confirm'}
          </button>
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Disable 2FA ───────────────────────────────────────────────────────────────

function Disable2FAPanel({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.disable2FA(password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable 2FA');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Disable 2FA" onClose={onClose}>
      <p className="text-sm text-slate-600">Enter your password to confirm.</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          placeholder="Current password"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="flex-1 rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {loading ? 'Disabling…' : 'Disable 2FA'}
          </button>
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Backup Codes ──────────────────────────────────────────────────────────────

function BackupCodesPanel({ onClose }: { onClose: () => void }) {
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [newCodes, setNewCodes]   = useState<string[] | null>(null);

  const handleRegenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.regenerateBackupCodes(password);
      setNewCodes(res.backupCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate');
    } finally {
      setLoading(false);
    }
  };

  if (newCodes) {
    return (
      <Modal title="New backup codes" onClose={onClose}>
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">Old backup codes are now invalid. Save these new ones.</p>
        <div className="grid grid-cols-2 gap-1.5 font-mono text-sm bg-slate-50 rounded p-3 border border-slate-200">
          {newCodes.map(c => <span key={c} className="text-center">{c}</span>)}
        </div>
        <button onClick={onClose} className="w-full rounded bg-[#28258b] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70]">Done</button>
      </Modal>
    );
  }

  return (
    <Modal title="Regenerate backup codes" onClose={onClose}>
      <p className="text-sm text-slate-600">This will invalidate all existing backup codes. Enter your password to continue.</p>
      <form onSubmit={handleRegenerate} className="space-y-3">
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          placeholder="Current password"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="flex-1 rounded bg-[#28258b] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50">
            {loading ? 'Generating…' : 'Regenerate'}
          </button>
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Change Password ───────────────────────────────────────────────────────────

function ChangePasswordPanel({ onClose }: { onClose: () => void }) {
  const [form, setForm]     = useState({ current: '', next: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) { setError('Passwords do not match'); return; }
    setError(null);
    setLoading(true);
    try {
      await api.changePassword(form.current, form.next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Change Password" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {(['current', 'next', 'confirm'] as const).map(f => (
          <div key={f}>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {f === 'current' ? 'Current password' : f === 'next' ? 'New password' : 'Confirm new password'}
            </label>
            <input
              type="password"
              value={form[f]}
              onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))}
              required
              minLength={f !== 'current' ? 8 : undefined}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
            />
          </div>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="flex-1 rounded bg-[#28258b] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50">
            {loading ? 'Saving…' : 'Change password'}
          </button>
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Generic modal wrapper ─────────────────────────────────────────────────────

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}
