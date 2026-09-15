import React, { useEffect, useState } from 'react';
import { Download, Mail, Pencil, Save, Search, UsersRound, X } from 'lucide-react';
import { getExternalUserAccess, ExternalUserAccess, updateExternalUserAccess } from '../../services/auth';
import { EmailPreview, generateWelcomeEmailPreview, sendWelcomeEmail } from '../../services/email';
import { RichTextEmailEditor } from './RichTextEmailEditor';
import { notifyError, notifySuccess } from '../common/notifications';
import { subscribeToStorage } from '../../services/storage';

const statuses: ExternalUserAccess['status'][] = ['PENDING', 'DONE', 'REJECTED'];
const emailStatuses: ExternalUserAccess['email_status'][] = ['NOT_READY', 'READY', 'SENDING', 'SENT', 'FAILED'];
type EditableUserField = 'username' | 'email' | 'password' | 'company_name' | 'full_name' | 'mobile_number' | 'status';

const statusSelectClasses: Record<ExternalUserAccess['status'], string> = {
  PENDING: 'border-amber-300 bg-amber-50 text-amber-700',
  DONE: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-rose-300 bg-rose-50 text-rose-700',
};

const queueStatusPriority: Record<ExternalUserAccess['status'], number> = {
  PENDING: 0,
  REJECTED: 1,
  DONE: 2,
};

const copyPlainText = async (value: string, label: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('Copy command was unavailable.');
    }
    notifySuccess(`${label} copied to clipboard.`);
  } catch {
    notifyError(`Unable to copy ${label.toLowerCase()}.`);
  }
};

interface CopyableValueProps {
  value: string;
  label: string;
  className?: string;
}

function CopyableValue({ value, label, className = '' }: CopyableValueProps) {
  const copyValue = () => void copyPlainText(value, label);

  return (
    <span
      role="button"
      tabIndex={0}
      onDoubleClick={copyValue}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          copyValue();
        }
      }}
      className={`block cursor-copy select-none truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
      title={`${value}\nDouble-click to copy ${label.toLowerCase()}`}
      aria-label={`${value}. Double-click or press Enter to copy ${label.toLowerCase()}`}
    >
      {value}
    </span>
  );
}

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
  const [editingUser, setEditingUser] = useState<ExternalUserAccess | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadUsers = () => void getExternalUserAccess().then((records) => {
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
    loadUsers();
    const unsubscribe = subscribeToStorage(loadUsers);
    return () => {
      isMounted = false;
      unsubscribe();
    };
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
    if (status === 'REJECTED') {
      notifyError('Reject the linked Company Registration to select a reason and prepare the rejection email.');
      return;
    }
    const saved = await updateUser(user, { status });
    if (saved?.status === 'DONE') await openPreview(saved);
  };

  const saveUserDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingUser) return;
    const requiredValues = [editingUser.username, editingUser.email, editingUser.password, editingUser.full_name, editingUser.mobile_number];
    if (requiredValues.some((value) => !value.trim())) {
      notifyError('Username, email, password, full name, and mobile number are required.');
      return;
    }

    const previousStatus = users.find((user) => user.id === editingUser.id)?.status;
    setSavingEdit(true);
    try {
      const saved = await updateExternalUserAccess(editingUser.id, {
        username: editingUser.username,
        email: editingUser.email,
        password: editingUser.password,
        company_name: editingUser.company_name.trim().toUpperCase(),
        full_name: editingUser.full_name,
        mobile_number: editingUser.mobile_number,
        status: editingUser.status,
        rejection_reason: editingUser.status === 'REJECTED' ? editingUser.rejection_reason : undefined,
        rejection_detail: editingUser.status === 'REJECTED' ? editingUser.rejection_detail : undefined,
      });
      setUsers((current) => current.map((user) => user.id === saved.id ? { ...user, ...saved } : user));
      setEditingUser(null);
      notifySuccess('User details updated in the database.');
      if (previousStatus !== 'DONE' && saved.status === 'DONE') await openPreview(saved);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to update user details.');
    } finally {
      setSavingEdit(false);
    }
  };

  const changeEditField = (field: EditableUserField, value: string) => {
    setEditingUser((current) => current ? { ...current, [field]: value } : current);
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
      notifySuccess('Registration email sent through Gmail.');
    } catch (error) {
      setUsers((current) => current.map((item) => item.id === previewUserId
        ? { ...item, email_status: 'FAILED', email_sent: 0 }
        : item));
      notifyError(error instanceof Error ? error.message : 'Unable to send the welcome email.');
    } finally {
      setSending(false);
    }
  };

  const filteredUsers = users
    .filter((user) => {
      const term = searchTerm.toLowerCase();
      const resolvedEmailStatus = user.email_status || (['DONE', 'REJECTED'].includes(user.status) ? 'READY' : 'NOT_READY');
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
    })
    .sort((left, right) => {
      const statusDifference = queueStatusPriority[left.status] - queueStatusPriority[right.status];
      const dateDifference = Date.parse(left.created_at) - Date.parse(right.created_at);
      return statusDifference || dateDifference || left.id.localeCompare(right.id);
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
      user.company_name.toUpperCase(),
      user.full_name,
      user.mobile_number,
      user.status,
      user.email_status || (['DONE', 'REJECTED'].includes(user.status) ? 'READY' : 'NOT_READY'),
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
        <p className="text-xs text-slate-500 mt-1">Users registered through the company registration form. Double-click a text value to copy it.</p>
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
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[1180px] table-fixed border-collapse text-left text-[11px]">
            <colgroup>
              <col className="w-[9%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead>
              <tr className="whitespace-nowrap border-b border-slate-200 bg-slate-50 text-[9px] font-bold uppercase tracking-wide text-slate-600 xl:text-[10px]">
                <th className="px-2 py-2.5">Username</th>
                <th className="px-2 py-2.5">Email address</th>
                <th className="px-2 py-2.5">Password</th>
                <th className="px-2 py-2.5">Company</th>
                <th className="px-2 py-2.5">Full name</th>
                <th className="px-2 py-2.5 text-center">Mobile number</th>
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
                  <td className="px-2 py-2 font-semibold text-slate-900"><CopyableValue value={user.username} label="Username" /></td>
                  <td className="px-2 py-2 text-slate-700"><CopyableValue value={user.email} label="Email address" /></td>
                  <td className="px-2 py-2 font-mono text-[10px] text-slate-700"><CopyableValue value={user.password || 'Unavailable'} label="Password" /></td>
                  <td className="px-2 py-2 text-slate-700"><CopyableValue value={user.company_name.toUpperCase()} label="Company name" /></td>
                  <td className="px-2 py-2 text-slate-700"><CopyableValue value={user.full_name} label="Full name" /></td>
                  <td className="px-2 py-2 text-center text-slate-700"><CopyableValue value={user.mobile_number} label="Mobile number" /></td>
                  <td className="px-2 py-2 text-center">
                    <select
                      value={user.status || 'PENDING'}
                      onChange={(event) => void changeStatus(user, event.target.value as ExternalUserAccess['status'])}
                      disabled={user.status === 'REJECTED' || savingKeys.has(`${user.id}-status`)}
                      title={user.status === 'REJECTED' ? 'Reopen this registration from Company Registration' : undefined}
                      className={`h-6 w-full max-w-[5.5rem] rounded-md border px-1 text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-60 ${statusSelectClasses[user.status || 'PENDING']}`}
                      aria-label={`Status for ${user.username}`}
                    >
                      {statuses.map((status) => <option key={status} value={status} disabled={status === 'REJECTED' && user.status !== 'REJECTED'}>{status}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <CopyableValue
                      value={user.email_status || (['DONE', 'REJECTED'].includes(user.status) ? 'READY' : 'NOT_READY')}
                      label="Email status"
                      className="mx-auto h-7 w-[4.75rem] whitespace-nowrap bg-slate-50 py-1.5 text-[10px] font-semibold text-slate-600"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingUser({ ...user })}
                        className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 text-[10px] font-bold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                      >
                        <Pencil className="h-3 w-3 shrink-0" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void openPreview(user)}
                        disabled={!['DONE', 'REJECTED'].includes(user.status) || (user.status === 'REJECTED' && !user.rejection_reason) || openingPreview === user.id || user.email_status === 'SENDING'}
                        className="inline-flex h-7 w-[4.75rem] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-1 text-[10px] font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        <Mail className="h-3 w-3 shrink-0" />
                        {openingPreview === user.id ? 'Loading...' : user.email_status === 'SENT' ? 'Resend' : ['DONE', 'REJECTED'].includes(user.status) ? 'Preview' : 'Set status'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-slate-900/55 p-4 backdrop-blur-xs">
          <form onSubmit={saveUserDetails} role="dialog" aria-modal="true" aria-labelledby="edit-user-title" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
              <div>
                <h3 id="edit-user-title" className="font-bold text-slate-900">Edit User Access</h3>
                <p className="mt-0.5 text-xs text-slate-500">Changes are saved directly to the user access database.</p>
              </div>
              <button type="button" onClick={() => setEditingUser(null)} disabled={savingEdit} aria-label="Close edit user popup" className="rounded-lg p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-5 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">Username
                <input autoFocus required value={editingUser.username} onChange={(event) => changeEditField('username', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Email address
                <input type="email" required value={editingUser.email} onChange={(event) => changeEditField('email', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Password
                <input required value={editingUser.password} onChange={(event) => changeEditField('password', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-mono font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Company
                <input value={editingUser.company_name} onChange={(event) => changeEditField('company_name', event.target.value.toUpperCase())} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal uppercase focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Full name
                <input required value={editingUser.full_name} onChange={(event) => changeEditField('full_name', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Mobile number
                <input type="tel" required value={editingUser.mobile_number} onChange={(event) => changeEditField('mobile_number', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Registration status
                <select value={editingUser.status} disabled={editingUser.status === 'REJECTED'} title={editingUser.status === 'REJECTED' ? 'Reopen this registration from Company Registration' : undefined} onChange={(event) => changeEditField('status', event.target.value)} className={`mt-1.5 h-9 w-full rounded-lg border px-3 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70 ${statusSelectClasses[editingUser.status]}`}>
                  {statuses.map((status) => <option key={status} value={status} disabled={status === 'REJECTED' && editingUser.status !== 'REJECTED'}>{status}</option>)}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
              <button type="button" onClick={() => setEditingUser(null)} disabled={savingEdit} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={savingEdit} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"><Save className="h-4 w-4" />{savingEdit ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

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
              <div className="text-xs font-semibold text-slate-700">Message
                <RichTextEmailEditor value={preview.body} onChange={(body) => setPreview((current) => current ? { ...current, body } : current)} minHeightClassName="min-h-64" />
              </div>
              {preview.attachments.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-700">Attachments</div>
                  <div className="space-y-1.5">
                    {preview.attachments.map((attachment) => (
                      <div key={attachment.path} className="flex items-center gap-2 text-xs text-slate-600">
                        <Download className="h-3.5 w-3.5 text-slate-400" />
                        <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                        <span className="text-slate-400">{(attachment.size / 1024 / 1024).toFixed(2)} MB</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
