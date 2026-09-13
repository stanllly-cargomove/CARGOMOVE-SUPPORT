import React, { useEffect, useState } from 'react';
import { Mail, Search, UsersRound } from 'lucide-react';
import { getExternalUserAccess, ExternalUserAccess, updateExternalUserAccess } from '../../services/auth';
import { notifyError, notifySuccess } from '../common/notifications';

const statuses: ExternalUserAccess['status'][] = ['PENDING', 'DONE', 'REJECTED'];

export function UserRegistration() {
  const [users, setUsers] = useState<ExternalUserAccess[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let isMounted = true;
    void getExternalUserAccess().then((records) => {
      if (isMounted) {
        setUsers(records);
        setLoadError('');
      }
    }).catch((error) => {
      if (isMounted) {
        setUsers([]);
        setLoadError(error instanceof Error ? error.message : 'Unable to load company users.');
      }
    });
    return () => { isMounted = false; };
  }, []);

  const updateUser = async (user: ExternalUserAccess, changes: Partial<Pick<ExternalUserAccess, 'status' | 'email_sent'>>) => {
    const key = `${user.id}-${Object.keys(changes)[0]}`;
    const previous = { ...user };
    setSavingKeys((current) => new Set(current).add(key));
    setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...changes } : item));
    try {
      const saved = await updateExternalUserAccess(user.id, changes);
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...saved } : item));
      notifySuccess(changes.status ? 'Registration status updated.' : 'Email marked as sent.');
    } catch (error) {
      setUsers((current) => current.map((item) => item.id === user.id ? previous : item));
      notifyError(error instanceof Error ? error.message : 'Unable to update registration.');
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const filteredUsers = users.filter((user) => {
    const term = searchTerm.toLowerCase();
    return !term || [user.username, user.email, user.company_name, user.full_name, user.mobile_number, user.status]
      .some((value) => value.toLowerCase().includes(term));
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">User Registration</h2>
        <p className="text-xs text-slate-500 mt-1">Users registered through the company registration form.</p>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative max-w-md">
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search username, email, company or name..."
            className="w-full px-3.5 py-2 pl-9 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Username</th>
                <th className="py-3 px-4">Email address</th>
                <th className="py-3 px-4">Password</th>
                <th className="py-3 px-4">Company</th>
                <th className="py-3 px-4">Full name</th>
                <th className="py-3 px-4">Mobile number</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    <UsersRound className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    {loadError || 'No company users found.'}
                  </td>
                </tr>
              ) : filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 font-semibold text-slate-900">{user.username}</td>
                  <td className="py-3 px-4 text-slate-700">{user.email}</td>
                  <td className="py-3 px-4 font-mono text-slate-700" title="External-system password">{user.password || 'Unavailable (legacy record)'}</td>
                  <td className="py-3 px-4 text-slate-700">{user.company_name}</td>
                  <td className="py-3 px-4 text-slate-700">{user.full_name}</td>
                  <td className="py-3 px-4 text-slate-700">{user.mobile_number}</td>
                  <td className="py-3 px-4">
                    <select
                      value={user.status || 'PENDING'}
                      onChange={(event) => void updateUser(user, { status: event.target.value as ExternalUserAccess['status'] })}
                      disabled={savingKeys.has(`${user.id}-status`)}
                      className="h-8 w-28 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-wait disabled:opacity-60"
                      aria-label={`Status for ${user.username}`}
                    >
                      {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => void updateUser(user, { email_sent: 1 })}
                      disabled={user.email_sent === 1 || savingKeys.has(`${user.id}-email_sent`)}
                      className="inline-flex h-8 min-w-28 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {user.email_sent === 1 ? 'Email Sent' : 'Send Email'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
