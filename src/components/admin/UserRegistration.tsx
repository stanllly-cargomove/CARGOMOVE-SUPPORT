import React, { useEffect, useState } from 'react';
import { Download, Mail, Search, UsersRound, X } from 'lucide-react';
import { getExternalUserAccess, ExternalUserAccess, updateExternalUserAccess } from '../../services/auth';
import { EmailPreview, generateWelcomeEmailPreview, sendWelcomeEmail } from '../../services/email';
import { notifyError, notifySuccess } from '../common/notifications';

const statuses: ExternalUserAccess['status'][] = ['PENDING', 'DONE', 'REJECTED'];
const emailStatuses: ExternalUserAccess['email_status'][] = ['NOT_READY', 'READY', 'SENDING', 'SENT', 'FAILED'];

export function UserRegistration() {
  const [users, setUsers] = useState<ExternalUserAccess[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState<'ALL' | ExternalUserAccess['status']>('ALL');
  const [emailStatusFilter, setEmailStatusFilter] = useState<'ALL' | ExternalUserAccess['email_status']>('ALL');
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
    const resolvedEmailStatus = user.email_status || (user.status === 'DONE' ? 'READY' : 'NOT_READY');
    const matchesSearch = !term || [
      user.username,
      user.email,
      user.company_name,
      user.full_name,
      user.mobile_number,
      user.status,
      resolvedEmailStatus,
    ].some((value) => String(value || '').toLowerCase().includes(term));
    return matchesSearch
      && (registrationStatusFilter === 'ALL' || user.status === registrationStatusFilter)
      && (emailStatusFilter === 'ALL' || resolvedEmailStatus === emailStatusFilter);
  });

  const downloadReport = () => {
    if (!filteredUsers.length) {
      notifyError('There are no registration records to download.');
      return;
    }
    const csvValue = (value: unknown) => {
      let text = String(value ?? '');
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = filteredUsers.map((user) => [
      user.username,
      user.email,
      user.password,
      user.company_name,
      user.full_name,
      user.mobile_number,
      user.status,
      user.email_status || (user.status === 'DONE' ? 'READY' : 'NOT_READY'),
    ]);
    const csv = [
      ['Username', 'Email Address', 'Password', 'Company', 'Full Name', 'Mobile Number', 'Registration Status', 'Email Status'],
      ...rows,
    ].map((row) => row.map(csvValue).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `user-registration-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notifySuccess('Registration report downloaded.');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">User Registration</h2>
        <p className="text-xs text-slate-500 mt-1">Users registered through the company registration form.</p>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative min-w-0 flex-1 lg:max-w-md">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search username, email, company or name..."
              className="h-9 w-full rounded-lg border border-slate-300 px-3.5 pl-9 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:ml-auto">
            <select
              value={registrationStatusFilter}
              onChange={(event) => setRegistrationStatusFilter(event.target.value as 'ALL' | ExternalUserAccess['status'])}
              className="h-9 min-w-44 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold uppercase text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Filter by registration status"
            >
              <option value="ALL">ALL REGISTRATION STATUSES</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select
              value={emailStatusFilter}
              onChange={(event) => setEmailStatusFilter(event.target.value as 'ALL' | ExternalUserAccess['email_status'])}
              className="h-9 min-w-40 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold uppercase text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Filter by email status"
            >
              <option value="ALL">ALL EMAIL STATUSES</option>
              {emailStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <button
              type="button"
              onClick={downloadReport}
              className="inline-flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-blue-600 px-2.5 text-[10px] font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              <Download className="h-3 w-3" />
              DOWNLOAD REPORT
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="w-full overflow-hidden">
          <table className="w-full table-fixed border-collapse text-left text-[11px]">
            <colgroup>
              <col className="w-[9%]" />
              <col className="w-[15%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="whitespace-nowrap border-b border-slate-200 bg-slate-50 text-[9px] font-bold uppercase tracking-wide text-slate-600 xl:text-[10px]">
                <th className="px-2 py-2.5">Username</th>
                <th className="px-2 py-2.5">Email address</th>
                <th className="px-2 py-2.5">Password</th>
                <th className="px-2 py-2.5">Company</th>
                <th className="px-2 py-2.5">Full name</th>
                <th className="px-2 py-2.5">Mobile number</th>
                <th className="px-2 py-2.5 text-center">Status</th>
                <th className="px-2 py-2.5 text-center">Email Status</th>
                <th className="px-2 py-2.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    <UsersRound className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    {loadError || (users.length ? 'No users match the selected filters.' : 'No company users found.')}
                  </td>
                </tr>
              ) : filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-2 py-2 font-semibold text-slate-900"><span className="block truncate" title={user.username}>{user.username}</span></td>
                  <td className="px-2 py-2 text-slate-700"><span className="block truncate" title={user.email}>{user.email}</span></td>
                  <td className="px-2 py-2 font-mono text-[10px] text-slate-700"><span className="block truncate" title={user.password || 'Unavailable (legacy record)'}>{user.password || 'Unavailable'}</span></td>
                  <td className="px-2 py-2 text-slate-700"><span className="block truncate" title={user.company_name}>{user.company_name}</span></td>
                  <td className="px-2 py-2 text-slate-700"><span className="block truncate" title={user.full_name}>{user.full_name}</span></td>
                  <td className="px-2 py-2 text-slate-700"><span className="block truncate" title={user.mobile_number}>{user.mobile_number}</span></td>
                  <td className="px-2 py-2 text-center">
                    <select
                      value={user.status || 'PENDING'}
                      onChange={(event) => void changeStatus(user, event.target.value as ExternalUserAccess['status'])}
                      disabled={savingKeys.has(`${user.id}-status`)}
                      className="h-7 w-full max-w-[6.25rem] rounded-md border border-slate-300 bg-white px-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-60"
                      aria-label={`Status for ${user.username}`}
                    >
                      {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-center"><span className="whitespace-nowrap text-[10px] font-semibold text-slate-600">{user.email_status || (user.status === 'DONE' ? 'READY' : 'NOT_READY')}</span></td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => void openPreview(user)}
                      disabled={user.status !== 'DONE' || openingPreview === user.id || user.email_status === 'SENDING'}
                      className="inline-flex h-7 w-full max-w-[6.75rem] items-center justify-center gap-1 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-1.5 text-[10px] font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <Mail className="h-3 w-3 shrink-0" />
                      {openingPreview === user.id ? 'Loading...' : user.email_status === 'SENT' ? 'Resend' : user.status === 'DONE' ? 'Preview' : 'Set DONE'}
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
