import React, { useEffect, useState } from 'react';
import { Mail, PlugZap, Save } from 'lucide-react';
import {
  connectGmail,
  EmailLog,
  getEmailLogs,
  getGmailStatus,
  getWelcomeEmailTemplate,
  saveWelcomeEmailTemplate,
  WelcomeEmailTemplate,
} from '../../services/email';
import { notifyError, notifySuccess } from '../common/notifications';

const emptyTemplate: WelcomeEmailTemplate = {
  id: 'cargomove-welcome',
  name: 'CargoMove Welcome Email',
  trigger_status: 'DONE',
  recipient_template: '{{user.email}}',
  subject_template: "Welcome to CargoMove! Let's Get You Started",
  body_template: '',
  active: true,
  version: 1,
};

export function EmailTemplateManager() {
  const [template, setTemplate] = useState<WelcomeEmailTemplate>(emptyTemplate);
  const [gmailEmail, setGmailEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [logs, setLogs] = useState<EmailLog[]>([]);

  useEffect(() => {
    void Promise.all([getWelcomeEmailTemplate(), getGmailStatus(), getEmailLogs()]).then(([saved, gmail, emailLogs]) => {
      if (saved) setTemplate(saved);
      if (gmail.connected && gmail.connection) setGmailEmail(gmail.connection.email);
      setLogs(emailLogs);
    }).catch((error) => notifyError(error instanceof Error ? error.message : 'Unable to load email settings.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveWelcomeEmailTemplate(template);
      setTemplate(saved);
      notifySuccess('Welcome email template saved.');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to save the template.');
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      await connectGmail();
    } catch (error) {
      setConnecting(false);
      notifyError(error instanceof Error ? error.message : 'Unable to start Gmail connection.');
    }
  };

  if (loading) return <div className="text-sm text-slate-500">Loading email settings...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Email Template</h2>
          <p className="mt-1 text-xs text-slate-500">Configure the welcome email shown after a user registration is marked DONE.</p>
        </div>
        <button type="button" onClick={() => void connect()} disabled={connecting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60">
          <PlugZap className="h-4 w-4" />
          {connecting ? 'Connecting...' : gmailEmail ? 'Reconnect Gmail' : 'Connect Gmail'}
        </button>
      </div>

      <div className={`rounded-xl border p-4 text-xs ${gmailEmail ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
        <div className="flex items-center gap-2 font-bold"><Mail className="h-4 w-4" />{gmailEmail ? `Connected as ${gmailEmail}` : 'Gmail is not connected'}</div>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Template name
            <input value={template.name} onChange={(event) => setTemplate({ ...template, name: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Trigger
            <input value="User Registration Status = DONE" disabled className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal text-slate-600" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Recipient
            <input value={template.recipient_template} disabled className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-mono font-normal text-slate-600" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Subject
            <input value={template.subject_template} onChange={(event) => setTemplate({ ...template, subject_template: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
        </div>
        <label className="block text-xs font-semibold text-slate-700">Email body
          <textarea value={template.body_template} onChange={(event) => setTemplate({ ...template, body_template: event.target.value })} rows={22} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs font-normal leading-5" />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">Available variables: <code>{'{{user.email}}'}</code>, <code>{'{{user.username}}'}</code>, <code>{'{{user.password}}'}</code></div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={template.active} onChange={(event) => setTemplate({ ...template, active: event.target.checked })} /> Active</label>
            <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"><Save className="h-4 w-4" />{saving ? 'Saving...' : 'Save Template'}</button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><h3 className="text-sm font-bold text-slate-900">Recent Email Logs</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-600"><tr><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Sent by</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Gmail ID</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No emails have been sent yet.</td></tr> : logs.map((log) => (
                <tr key={log.id}><td className="px-4 py-3 text-slate-700">{log.recipient}</td><td className="max-w-xs truncate px-4 py-3 text-slate-700">{log.subject}</td><td className="px-4 py-3 text-slate-600">{log.sent_by_email}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(log.sent_at || log.requested_at).toLocaleString()}</td><td className={`px-4 py-3 font-bold ${log.status === 'SENT' ? 'text-emerald-700' : log.status === 'FAILED' ? 'text-rose-700' : 'text-amber-700'}`}>{log.status}</td><td className="max-w-36 truncate px-4 py-3 font-mono text-slate-500">{log.gmail_message_id || '-'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
