import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';

const ROLES = ['super_admin', 'admin', 'manager', 'user', 'viewer'] as const;
type Role = typeof ROLES[number];

const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  user: 'User',
  viewer: 'Viewer',
};

const ROLE_RANK: Record<Role, number> = {
  super_admin: 5, admin: 4, manager: 3, user: 2, viewer: 1,
};

function canManage(actorRole: Role, targetRole: Role) {
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

interface User {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: 'active' | 'invited' | 'disabled';
  two_factor_enabled: number;
  last_login_at: string | null;
  created_at: string;
}

interface Invite {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invited_by_user_id: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

type PanelTab = 'users' | 'invites';

export function UserManagement() {
  const { user: me } = useAuth();
  const [activeTab, setActiveTab]     = useState<PanelTab>('users');
  const [users, setUsers]             = useState<User[]>([]);
  const [invites, setInvites]         = useState<Invite[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showInvite, setShowInvite]   = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [usersData, invitesData] = await Promise.all([
        api.getUsers(),
        api.getInvites(),
      ]);
      setUsers(usersData);
      setInvites(invitesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDisable = async (u: User) => {
    if (!confirm(`Disable ${u.email}?`)) return;
    try { await api.disableUser(u.id); load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const handleEnable = async (u: User) => {
    try { await api.enableUser(u.id); load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const handleRevoke = async (inv: Invite) => {
    if (!confirm(`Revoke invite for ${inv.email}?`)) return;
    try { await api.revokeInvite(inv.id); load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const handleResend = async (inv: Invite) => {
    try {
      const data = await api.resendInvite(inv.id);
      await navigator.clipboard.writeText(data.inviteLink).catch(() => {});
      alert(`New invite link (copied to clipboard):\n\n${data.inviteLink}`);
      load();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (error)   return <div className="p-6 text-sm text-red-600">{error}</div>;

  const pendingInvites = invites.filter(i => i.status === 'pending');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['users', 'invites'] as PanelTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab
                  ? 'bg-[#28258b] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab === 'users' ? 'Users' : `Invites${pendingInvites.length > 0 ? ` (${pendingInvites.length})` : ''}`}
            </button>
          ))}
        </div>
        {me && ROLE_RANK[me.role as Role] >= ROLE_RANK.admin && (
          <button
            onClick={() => setShowInvite(true)}
            className="rounded-lg bg-[#28258b] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1f1d70]"
          >
            + Invite User
          </button>
        )}
      </div>

      {activeTab === 'users' && (
        <UsersTable
          users={users}
          me={me}
          onDisable={handleDisable}
          onEnable={handleEnable}
          onReset={u => setResetTarget(u)}
        />
      )}

      {activeTab === 'invites' && (
        <InvitesTable
          invites={invites}
          me={me}
          onRevoke={handleRevoke}
          onResend={handleResend}
        />
      )}

      {showInvite && (
        <InviteUserModal
          actorRole={me?.role as Role}
          onClose={() => setShowInvite(false)}
          onInvited={() => { setShowInvite(false); load(); }}
        />
      )}

      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onReset={() => setResetTarget(null)}
        />
      )}
    </div>
  );
}

// ── Users Table ───────────────────────────────────────────────────────────────

function UsersTable({
  users, me, onDisable, onEnable, onReset,
}: {
  users: User[];
  me: any;
  onDisable: (u: User) => void;
  onEnable: (u: User) => void;
  onReset: (u: User) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-slate-600">User</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Role</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">2FA</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Last login</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map(u => {
            const manageable = me ? canManage(me.role as Role, u.role) && me.id !== u.id : false;
            return (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{u.name || u.email}</div>
                  {u.name && <div className="text-xs text-slate-400">{u.email}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {ROLE_LABEL[u.role]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    u.status === 'active'   ? 'bg-green-100 text-green-700' :
                    u.status === 'disabled' ? 'bg-red-100 text-red-700'    :
                                              'bg-amber-100 text-amber-700'
                  }`}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.two_factor_enabled ? (
                    <span className="text-green-600 text-xs font-medium">On</span>
                  ) : (
                    <span className="text-slate-400 text-xs">Off</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-4 py-3">
                  {manageable && (
                    <div className="flex gap-2 justify-end">
                      {u.status === 'active' ? (
                        <button onClick={() => onDisable(u)} className="text-xs text-red-600 hover:underline">
                          Disable
                        </button>
                      ) : (
                        <button onClick={() => onEnable(u)} className="text-xs text-green-600 hover:underline">
                          Enable
                        </button>
                      )}
                      <button onClick={() => onReset(u)} className="text-xs text-[#28258b] hover:underline">
                        Reset pwd
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Invites Table ─────────────────────────────────────────────────────────────

function InvitesTable({
  invites, me, onRevoke, onResend,
}: {
  invites: Invite[];
  me: any;
  onRevoke: (inv: Invite) => void;
  onResend: (inv: Invite) => void;
}) {
  if (invites.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
        No invites yet. Use "Invite User" to send an invite link.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Role</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Expires / Accepted</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invites.map(inv => {
            const canAct = me ? canManage(me.role as Role, inv.role) : false;
            const expired = inv.status === 'pending' && new Date(inv.expires_at) < new Date();
            return (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{inv.email}</div>
                  {inv.name && <div className="text-xs text-slate-400">{inv.name}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {ROLE_LABEL[inv.role] ?? inv.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    inv.status === 'accepted' ? 'bg-green-100 text-green-700' :
                    inv.status === 'revoked'  ? 'bg-red-100 text-red-700' :
                    inv.status === 'expired' || expired ? 'bg-slate-100 text-slate-500' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {expired && inv.status === 'pending' ? 'expired' : inv.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {inv.accepted_at
                    ? `Accepted ${new Date(inv.accepted_at).toLocaleDateString()}`
                    : `Expires ${new Date(inv.expires_at).toLocaleString()}`
                  }
                </td>
                <td className="px-4 py-3">
                  {canAct && inv.status === 'pending' && !expired && (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => onResend(inv)} className="text-xs text-[#28258b] hover:underline">
                        Resend
                      </button>
                      <button onClick={() => onRevoke(inv)} className="text-xs text-red-600 hover:underline">
                        Revoke
                      </button>
                    </div>
                  )}
                  {canAct && (inv.status === 'expired' || (inv.status === 'pending' && expired) || inv.status === 'revoked') && (
                    <button onClick={() => onResend(inv)} className="text-xs text-[#28258b] hover:underline">
                      Reissue
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Invite User Modal ─────────────────────────────────────────────────────────

function InviteUserModal({
  actorRole,
  onClose,
  onInvited,
}: {
  actorRole: Role;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [form, setForm] = useState({ email: '', name: '', role: 'user' as Role });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const allowedRoles = ROLES.filter(r => ROLE_RANK[actorRole] > ROLE_RANK[r]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.inviteUser(form);
      setInviteLink(data.inviteLink);
      await navigator.clipboard.writeText(data.inviteLink).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setLoading(false);
    }
  };

  if (inviteLink) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl p-6 space-y-4">
          <h3 className="text-base font-semibold text-green-700">Invite created</h3>
          <p className="text-sm text-slate-600">
            Share this link with <strong>{form.email}</strong>. It expires in 48 hours.
          </p>
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 break-all select-all">
            {inviteLink}
          </div>
          <p className="text-xs text-slate-400">Link has been copied to clipboard (if permitted).</p>
          <div className="flex gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(inviteLink).catch(() => {})}
              className="flex-1 rounded border border-[#28258b] px-3 py-2 text-sm text-[#28258b] hover:bg-slate-50"
            >
              Copy link
            </button>
            <button
              onClick={onInvited}
              className="flex-1 rounded-lg bg-[#28258b] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70]"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Invite User</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
              placeholder="name@unilog.company"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Name <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role *</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              {allowedRoles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-lg bg-[#28258b] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70] disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send invite'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Reset Password Modal ──────────────────────────────────────────────────────

function ResetPasswordModal({
  user,
  onClose,
  onReset,
}: {
  user: User;
  onClose: () => void;
  onReset: () => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.resetUserPassword(user.id, newPassword);
      onReset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Reset password for {user.name || user.email}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              minLength={8}
              required
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? 'Resetting…' : 'Reset password'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
