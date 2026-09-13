import React, { useEffect, useState } from 'react';
import { Mail, Search, UsersRound, X } from 'lucide-react';
import { getExternalUserAccess, ExternalUserAccess, updateExternalUserAccess } from '../../services/auth';
import { EmailPreview, generateWelcomeEmailPreview, sendWelcomeEmail } from '../../services/email';
import { notifyError, notifySuccess } from '../common/notifications';

const statuses: ExternalUserAccess['status'][] = ['PENDING', 'DONE', 'REJECTED'];

export function UserRegistration() {
  const [users, setUsers] = useState<ExternalUserAccess[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState('');
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [previewUserId, setPreviewUserId] = useState('');
  const [openingPreview, setOpeningPreview] = useState('');
  const [sending, setSending] = useState(false);

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

  const updateUser = async (user: ExternalUserAccess, changes: Partial<Pick<ExternalUserAccess, 'status'>>) => {
    const key = `${user.id}-${Object.keys(changes)[0]}`;
    const previous = { ...user };
    setSavingKeys((current) => new Set(current).add(key));
    setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...changes } : item));
    try {
      const saved = await updateExternalUserAccess(user.id, changes);
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...saved } : item));
      notifySuccess('Registration status updated.');
      return saved;
    } catch (error) {
      setUsers((current) => current.map((item) => item.id === user.id ? previous : item));
      notifyError(error instanceof Error ? error.message : 'Unable to update registration.');
      return null;
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const openPreview = async (user: ExternalUserAccess) => {
    setOpeningPreview(user.id);
    try {
      const generated = await generateWelcomeEmailPreview(user.id);
      setPreviewUserId(user.id);
      setPreview(generated);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to generate the email preview.');
    } finally {
      setOpeningPreview('');
    }
  };

  const changeStatus = async (user: ExternalUserAccess, status: ExternalUserAccess['status']) => {
    const saved = await updateUser(user, { status });
    if (saved?.status === 'DONE') await openPreview(saved);
  };

  const sendPreview = async () => {
    if (!preview) return;
    setSending(true);
    try {
      await sendWelcomeEmail(preview);
      setUsers((current) => current.map((item) => item.id === previewUserId
        ? { ...item, email_status: 'SENT', email_sent: 1 }
        : item));
      setPreview(null);
      notifySuccess('Welcome email sent through Gmail.');
    } catch (error) {
      setUsers((current) => current.map((item) => item.id === previewUserId
        ? { ...item, email_status: 'FAILED', email_sent: 0 }
        : item));
      notifyError(error instanceof Error ? error.message : 'Unable to send the welcome email.');
    } finally {
      setSending(false);
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
                <th className="py-3 px-4">Email Status</th>
                <th className="py-3 px-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
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
                      onChange={(event) => void changeStatus(user, event.target.value as ExternalUserAccess['status'])}
                      disabled={savingKeys.has(`${user.id}-status`)}
                      className="h-8 w-28 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-wait disabled:opacity-60"
                      aria-label={`Status for ${user.username}`}
                    >
                      {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </td>
                  <td className="py-3 px-4"><span className="whitespace-nowrap font-semibold text-slate-600">{user.email_status || (user.status === 'DONE' ? 'READY' : 'NOT_READY')}</span></td>
                  <td className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => void openPreview(user)}
                      disabled={user.status !== 'DONE' || openingPreview === user.id || user.email_status === 'SENDING'}
                      className="inline-flex h-8 min-w-28 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {openingPreview === user.id ? 'Loading...' : user.email_status === 'SENT' ? 'Preview / Resend' : user.status === 'DONE' ? 'Preview Email' : 'Set DONE First'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" aria-labelledby="email-preview-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div><h3 id="email-preview-title" className="font-bold text-slate-900">Email Preview</h3><p className="mt-0.5 text-xs text-slate-500">{preview.templateName}</p></div>
              <button type="button" onClick={() => setPreview(null)} disabled={sending} className="rounded-lg p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5">
              <label className="block text-xs font-semibold text-slate-700">To
                <input value={preview.recipient} readOnly className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal text-slate-700" />
              </label>
              <label className="block text-xs font-semibold text-slate-700">Subject
                <input value={preview.subject} onChange={(event) => setPreview({ ...preview, subject: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
              </label>
              <label className="block text-xs font-semibold text-slate-700">Message
                <textarea value={preview.body} onChange={(event) => setPreview({ ...preview, body: event.target.value })} rows={20} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs font-normal leading-5" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button type="button" onClick={() => setPreview(null)} disabled={sending} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200">Cancel</button>
              <button type="button" onClick={() => void sendPreview()} disabled={sending} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"><Mail className="h-4 w-4" />{sending ? 'Sending...' : 'Send Email'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
