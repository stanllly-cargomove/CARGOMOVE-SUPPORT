import React, { useEffect, useState } from 'react';
import { ArrowLeft, CalendarClock, Mail, Paperclip, Pencil, PlugZap, Plus, Save, Trash2 } from 'lucide-react';
import {
  connectGmail,
  deleteEmailTemplate,
  EmailLog,
  EmailTemplate,
  getEmailLogs,
  getEmailTemplates,
  getGmailStatus,
  saveEmailTemplate,
  uploadEmailAttachment,
} from '../../services/email';
import { notifyError, notifySuccess } from '../common/notifications';
import { RichTextEmailEditor } from './RichTextEmailEditor';

type EmailTemplateManagerProps = { onViewChange?: (view: 'list' | 'design') => void };

const newTemplate = (active: boolean): EmailTemplate => ({
  id: `email-${crypto.randomUUID()}`,
  name: '',
  trigger_status: 'DONE',
  recipient_template: '{{user.email}}',
  subject_template: '',
  body_template: '',
  attachments: [],
  active,
  version: 1,
});

export function EmailTemplateManager({ onViewChange }: EmailTemplateManagerProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const load = async () => {
    const [saved, gmail, emailLogs] = await Promise.all([getEmailTemplates(), getGmailStatus(), getEmailLogs()]);
    setTemplates(saved);
    setGmailEmail(gmail.connected && gmail.connection ? gmail.connection.email : '');
    setLogs(emailLogs);
  };

  useEffect(() => {
    void load().catch((error) => notifyError(error instanceof Error ? error.message : 'Unable to load email settings.')).finally(() => setLoading(false));
  }, []);

  const openDesigner = (template: EmailTemplate, create = false) => {
    setEditing({ ...template, attachments: [...template.attachments] });
    setIsCreating(create);
    setPendingFiles([]);
    onViewChange?.('design');
  };

  const closeDesigner = () => {
    setEditing(null);
    setIsCreating(false);
    setPendingFiles([]);
    onViewChange?.('list');
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const pendingSize = pendingFiles.reduce((total, file) => total + file.size, 0);
      const savedSize = editing.attachments.reduce((total, file) => total + file.size, 0);
      const allowedTypes = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png']);
      if (editing.attachments.length + pendingFiles.length > 5) throw new Error('A template can have up to 5 attachments.');
      if (savedSize + pendingSize > 15 * 1024 * 1024) throw new Error('Attachments must be 15 MB or smaller in total.');
      if (pendingFiles.some((file) => !allowedTypes.has(file.type))) throw new Error('Only PDF, Word, Excel, JPG and PNG attachments are supported.');
      const uploaded = [];
      for (const file of pendingFiles) uploaded.push(await uploadEmailAttachment(file, editing.id));
      const saved = await saveEmailTemplate({ ...editing, attachments: [...editing.attachments, ...uploaded] }, isCreating);
      setTemplates(await getEmailTemplates());
      notifySuccess(`${saved.name} saved.`);
      closeDesigner();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to save the template.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (template: EmailTemplate) => {
    if (!window.confirm(`Remove “${template.name}”? This cannot be undone.`)) return;
    setDeletingId(template.id);
    try {
      await deleteEmailTemplate(template.id);
      setTemplates(await getEmailTemplates());
      notifySuccess(`${template.name} removed.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to remove the template.');
    } finally {
      setDeletingId('');
    }
  };

  const connect = async () => {
    setConnecting(true);
    try { await connectGmail(); }
    catch (error) {
      setConnecting(false);
      notifyError(error instanceof Error ? error.message : 'Unable to start Gmail connection.');
    }
  };

  if (loading) return <div className="text-sm text-slate-500">Loading email settings...</div>;

  if (editing) return (
    <div className="space-y-5">
      <button type="button" onClick={closeDesigner} className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-blue-700"><ArrowLeft className="h-4 w-4" />Back to Email Templates</button>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">{isCreating ? 'New template' : 'Edit template'}</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">Design Template</h2>
        <p className="mt-1 text-xs text-slate-500">Design the message recipients will receive when their registration is marked DONE.</p>
      </div>
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Template name
            <input autoFocus value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="e.g. Standard welcome email" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Trigger
            <input value="User Registration Status = DONE" disabled className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal text-slate-600" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Recipient
            <input value={editing.recipient_template} disabled className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-mono font-normal text-slate-600" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Subject
            <input value={editing.subject_template} onChange={(event) => setEditing({ ...editing, subject_template: event.target.value })} placeholder="Email subject" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
        </div>
        <div className="text-xs font-semibold text-slate-700">Email body
          <RichTextEmailEditor value={editing.body_template} onChange={(body_template) => setEditing((current) => current ? { ...current, body_template } : current)} />
          <p className="mt-1.5 text-[11px] font-normal text-slate-500">Available variables: <code>{'{{user.email}}'}</code>, <code>{'{{user.username}}'}</code>, <code>{'{{user.password}}'}</code></p>
        </div>
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Paperclip className="h-4 w-4" />Attachments</div><p className="mt-1 text-[11px] text-slate-500">PDF, Word, Excel, JPG or PNG. Up to 5 files and 15 MB total.</p></div>
            <label className="cursor-pointer rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50">Add files<input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" className="sr-only" onChange={(event) => { setPendingFiles((current) => [...current, ...Array.from(event.target.files || [])]); event.target.value = ''; }} /></label>
          </div>
          {editing.attachments.length === 0 && pendingFiles.length === 0 ? <p className="text-xs text-slate-500">No attachments.</p> : (
            <div className="space-y-2">
              {editing.attachments.map((attachment) => <div key={attachment.path} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"><Paperclip className="h-3.5 w-3.5 text-slate-400" /><span className="min-w-0 flex-1 truncate">{attachment.name}</span><span className="text-slate-400">{(attachment.size / 1024 / 1024).toFixed(2)} MB</span><button type="button" onClick={() => setEditing({ ...editing, attachments: editing.attachments.filter((item) => item.path !== attachment.path) })} aria-label={`Remove ${attachment.name}`} className="text-rose-500"><Trash2 className="h-4 w-4" /></button></div>)}
              {pendingFiles.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs"><Paperclip className="h-3.5 w-3.5 text-blue-500" /><span className="min-w-0 flex-1 truncate text-blue-800">{file.name} <span className="text-blue-500">(uploads when saved)</span></span><button type="button" onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== index))} className="text-rose-500"><Trash2 className="h-4 w-4" /></button></div>)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={editing.active} disabled={!isCreating && editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} />{editing.active ? 'Active welcome template' : 'Use as the active welcome template'}</label>
          <div className="flex gap-2"><button type="button" onClick={closeDesigner} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"><Save className="h-4 w-4" />{saving ? 'Saving...' : 'Save Template'}</button></div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 className="text-xl font-bold tracking-tight text-slate-900">Email Templates</h2><p className="mt-1 text-xs text-slate-500">Create and manage reusable emails for completed user registrations.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void connect()} disabled={connecting} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><PlugZap className="h-4 w-4" />{connecting ? 'Connecting...' : gmailEmail ? 'Reconnect Gmail' : 'Connect Gmail'}</button><button type="button" onClick={() => openDesigner(newTemplate(templates.length === 0), true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"><Plus className="h-4 w-4" />New Template</button></div>
      </div>
      <div className={`rounded-xl border p-4 text-xs ${gmailEmail ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><div className="flex items-center gap-2 font-bold"><Mail className="h-4 w-4" />{gmailEmail ? `Connected as ${gmailEmail}` : 'Gmail is not connected'}</div></div>
      {templates.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center"><Mail className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-3 text-sm font-bold text-slate-800">No email templates</h3><p className="mt-1 text-xs text-slate-500">Create your first reusable email template.</p></div> : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => <div key={template.id} onClick={() => openDesigner(template)} className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-bold text-slate-900">{template.name}</h3>{template.active && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Active</span>}</div><p className="mt-2 line-clamp-2 text-xs text-slate-500">{template.subject_template}</p></div><Mail className="h-5 w-5 shrink-0 text-slate-300 group-hover:text-blue-500" /></div>
            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3"><span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400"><CalendarClock className="h-3.5 w-3.5" />{template.updated_at ? new Date(template.updated_at).toLocaleDateString() : `Version ${template.version}`}</span><div className="flex gap-1"><button type="button" onClick={(event) => { event.stopPropagation(); openDesigner(template); }} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"><Pencil className="h-3.5 w-3.5" />Edit</button><button type="button" disabled={deletingId === template.id || templates.length === 1} title={templates.length === 1 ? 'At least one template is required' : 'Remove template'} onClick={(event) => { event.stopPropagation(); void remove(template); }} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />{deletingId === template.id ? 'Removing...' : 'Remove'}</button></div></div>
          </div>)}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h3 className="text-sm font-bold text-slate-900">Recent Email Logs</h3></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-600"><tr><th className="px-4 py-3">Template</th><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{logs.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No emails have been sent yet.</td></tr> : logs.map((log) => <tr key={log.id}><td className="px-4 py-3 font-semibold text-slate-700">{log.template_name}</td><td className="px-4 py-3 text-slate-700">{log.recipient}</td><td className="max-w-xs truncate px-4 py-3 text-slate-600">{log.subject}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(log.sent_at || log.requested_at).toLocaleString()}</td><td className={`px-4 py-3 font-bold ${log.status === 'SENT' ? 'text-emerald-700' : log.status === 'FAILED' ? 'text-rose-700' : 'text-amber-700'}`}>{log.status}</td></tr>)}</tbody></table></div></div>
    </div>
  );
}
