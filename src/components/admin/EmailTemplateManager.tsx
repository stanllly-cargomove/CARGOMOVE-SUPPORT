import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GoogleConnectionButton } from '../common/GoogleConnectionButton';
import { ArrowLeft, Paperclip, Pencil, Plus, Save, Trash2, Mail, MoreVertical } from 'lucide-react';
import {
  connectGmail,
  deleteEmailTemplate,
  EmailLog,
  EmailTemplate,
  EmailTemplatePort,
  getEmailLogs,
  saveEmailTemplate,
  uploadEmailAttachment,
} from '../../services/email';
import { getCachedEmailTemplateSettings, loadEmailTemplateSettings, clearEmailTemplateSettingsCache } from '../../services/emailTemplateSettings';
import { notifyError, notifySuccess } from '../common/notifications';
import { RichTextEmailEditor } from './RichTextEmailEditor';
import { formatAdminDate, formatAdminDateTime } from '../../utils/date';
import { emailTemplateRegistrationType } from '../../utils/registrationEmailTemplates';

type EmailTemplateManagerProps = { onViewChange?: (view: 'list' | 'design') => void };

function EmailTemplateActions({ template, deleteDisabled, onEdit, onDelete }: {
  template: EmailTemplate;
  deleteDisabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: -9999, left: -9999 });
  const close = () => setIsOpen(false);
  const supportsHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const isInside = (target: EventTarget | null) => target instanceof Node
    && (buttonRef.current?.contains(target) || menuRef.current?.contains(target));
  const leave = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && supportsHover() && !isInside(event.relatedTarget)) close();
  };

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current || !menuRef.current) return;
    const button = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const padding = 8;
    setPosition({
      top: button.bottom + menu.height <= window.innerHeight - padding
        ? button.bottom : Math.max(padding, button.top - menu.height),
      left: Math.max(padding, Math.min(button.right - menu.width, window.innerWidth - menu.width - padding)),
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: PointerEvent) => { if (!isInside(event.target)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { close(); buttonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [isOpen]);

  return <>
    <button ref={buttonRef} type="button" aria-label={`Actions for ${template.template_code}`} aria-haspopup="menu" aria-expanded={isOpen} aria-controls={isOpen ? menuId : undefined}
      onPointerEnter={event => { if (event.pointerType === 'mouse' && supportsHover()) setIsOpen(true); }} onPointerLeave={leave}
      onClick={event => { if (event.detail > 0 && supportsHover()) setIsOpen(true); else setIsOpen(value => !value); }}
      onBlur={event => { if (!isInside(event.relatedTarget)) close(); }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><MoreVertical aria-hidden="true" className="h-4 w-4" /></button>
    {isOpen && createPortal(<div ref={menuRef} style={position} className="fixed z-[80] w-32 py-1" onPointerLeave={leave}
      onBlur={event => { if (!isInside(event.relatedTarget)) close(); }}>
      <div id={menuId} role="menu" aria-label={`Actions for ${template.template_code}`} className="rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        <button type="button" role="menuitem" onClick={() => { close(); onEdit(); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" />Edit</button>
        <button type="button" role="menuitem" disabled={deleteDisabled} title={isProtectedTemplate(template.id) ? 'Built-in templates can be edited but not removed' : undefined} onClick={() => { close(); onDelete(); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />Delete</button>
      </div>
    </div>, document.body)}
  </>;
}

const isProtectedTemplate = (id: string) => [
  'cargomove-welcome',
  'rejection-already-registered-both',
  'rejection-northport-added',
  'rejection-no-ledger-code',
  'rejection-other',
].includes(id);

function getVisibleLogPageNumbers(currentPage: number, totalPages: number): number[] {
  const visibleCount = Math.min(5, totalPages);
  const start = Math.min(Math.max(1, currentPage - Math.floor(visibleCount / 2)), totalPages - visibleCount + 1);
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

const portAbbreviations: Record<string, string> = {
  'KUANTAN PORT CONSORTIUM KP1': 'KP1',
  'KUANTAN PORT CONSORTIUM KP2': 'KP2',
  'KUANTAN PORT - KP1': 'KP1',
  'KUANTAN PORT - KP2': 'KP2',
  WESTPORT: 'WP',
  NORTHPORT: 'NP',
  'PORT KLANG FREE ZONE': 'PKFZ',
  'LUMUT MARITIME TERMINAL': 'LP',
  'JOHOR PORT': 'JP',
  'PENANG PORT': 'PP',
};

function abbreviatedPortName(name: string): string {
  const normalized = name.trim().toUpperCase();
  if (normalized.includes('KUANTAN') && /KP\s*[- ]?1\b/.test(normalized)) return 'KP1';
  if (normalized.includes('KUANTAN') && /KP\s*[- ]?2\b/.test(normalized)) return 'KP2';
  return portAbbreviations[normalized] || name;
}

function assignedPortNames(template: EmailTemplate, ports: EmailTemplatePort[], abbreviated = false): string {
  const assignedIds = [...new Set(template.port_ids || [template.port_id].filter((id): id is string => !!id))];
  if (ports.length > 0 && ports.every((port) => assignedIds.includes(port.id))) return abbreviated ? 'ALL PORT' : ports.map((port) => port.display_name).join(', ');
  return assignedIds
    .map((id) => ports.find((port) => port.id === id)?.display_name || id)
    .map((name) => abbreviated ? abbreviatedPortName(name) : name)
    .join(', ') || 'None assigned';
}

const newTemplate = (active: boolean, triggerStatus: 'DONE' | 'REJECTED' = 'DONE', coded = false): EmailTemplate => ({
  id: `email-${crypto.randomUUID()}`,
  name: '',
  trigger_status: triggerStatus,
  port_id: null,
  port_ids: [],
  template_code: coded ? (triggerStatus === 'DONE' ? 'ACC' : 'REJ') : null,
  rejection_reason: null,
  recipient_template: '{{user.email}}',
  subject_template: '',
  body_template: '',
  attachments: [],
  active,
  version: 1,
  registration_type: 'COMPANY',
});

export function EmailTemplateManager({ onViewChange }: EmailTemplateManagerProps) {
  const [initialSettings] = useState(getCachedEmailTemplateSettings);
  const [templates, setTemplates] = useState<EmailTemplate[]>(initialSettings?.catalog.templates ?? []);
  const [ports, setPorts] = useState<EmailTemplatePort[]>(initialSettings?.catalog.ports ?? []);
  const [apiSupportsPortCodes, setApiSupportsPortCodes] = useState(initialSettings?.catalog.apiSupportsPortCodes ?? true);
  const [activeCodeTab, setActiveCodeTab] = useState<'DONE' | 'REJECTED'>('DONE');
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [gmailEmail, setGmailEmail] = useState(initialSettings?.gmail.connected ? initialSettings.gmail.connection?.email ?? '' : '');
  const [loading, setLoading] = useState(!initialSettings);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasLoaded, setHasLoaded] = useState(!!initialSettings);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [logs, setLogs] = useState<EmailLog[]>(initialSettings?.emailLogs.logs ?? []);
  const [logTotal, setLogTotal] = useState(initialSettings?.emailLogs.total ?? 0);
  const [logPage, setLogPage] = useState(1);
  const [prefetchingLogs, setPrefetchingLogs] = useState(false);
  const [logPrefetchError, setLogPrefetchError] = useState(false);
  const prefetchInFlight = useRef(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const applySettings = ({ catalog, gmail, emailLogs }: Awaited<ReturnType<typeof loadEmailTemplateSettings>>) => {
    setTemplates(catalog.templates);
    setPorts(catalog.ports);
    setApiSupportsPortCodes(catalog.apiSupportsPortCodes);
    setGmailEmail(gmail.connected && gmail.connection ? gmail.connection.email : '');
    setLogs(emailLogs.logs);
    setLogTotal(emailLogs.total ?? emailLogs.logs.length);
    setLogPage(1);
    setHasLoaded(true);
    setLoadError('');
  };
  const load = async (force = false) => {
    setRefreshing(true);
    try { applySettings(await loadEmailTemplateSettings(force)); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Unable to load email settings.'); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => {
    let active = true;
    setRefreshing(true);
    void loadEmailTemplateSettings().then(value => { if (active) applySettings(value); })
      .catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'Unable to load email settings.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, []);

  const openDesigner = (template: EmailTemplate, create = false) => {
    setEditing({ ...template, registration_type: (emailTemplateRegistrationType(template) || null) as EmailTemplate['registration_type'], port_ids: template.port_ids || (template.port_id ? [template.port_id] : []), attachments: [...template.attachments] });
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
      if (editing.template_code !== null && editing.template_code !== undefined) {
        if (!apiSupportsPortCodes) throw new Error('The API server is still using the old single-port template format. Restart the API server (or redeploy the backend), then reload this page and save again.');
        const pattern = editing.trigger_status === 'DONE' ? /^ACC\d{3}$/ : /^REJ\d{3}$/;
        if (!pattern.test(editing.template_code)) throw new Error(`Use ${editing.trigger_status === 'DONE' ? 'ACC' : 'REJ'} followed by exactly three digits (for example, ${editing.trigger_status === 'DONE' ? 'ACC001' : 'REJ001'}).`);
      }
      if (editing.template_code !== null && editing.template_code !== undefined && !editing.port_ids?.length && !editing.legacy_fallback) throw new Error('Select at least one port for this code.');
      const pendingSize = pendingFiles.reduce((total, file) => total + file.size, 0);
      const savedSize = editing.attachments.reduce((total, file) => total + file.size, 0);
      const allowedTypes = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png']);
      if (editing.attachments.length + pendingFiles.length > 5) throw new Error('A template can have up to 5 attachments.');
      if (savedSize + pendingSize > 15 * 1024 * 1024) throw new Error('Attachments must be 15 MB or smaller in total.');
      if (pendingFiles.some((file) => !allowedTypes.has(file.type))) throw new Error('Only PDF, Word, Excel, JPG and PNG attachments are supported.');
      const uploaded = [];
      for (const file of pendingFiles) uploaded.push(await uploadEmailAttachment(file, editing.id));
      const saved = await saveEmailTemplate({ ...editing, attachments: [...editing.attachments, ...uploaded] }, isCreating);
      clearEmailTemplateSettingsCache();
      await load(true);
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
      clearEmailTemplateSettingsCache();
      await load(true);
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

  const visibleTemplates = templates
    .filter((template) => template.template_code && template.trigger_status === activeCodeTab)
    .sort((first, second) => (first.template_code || '').localeCompare(second.template_code || ''));
  const logsPerPage = 15;
  const logPageCount = Math.max(1, Math.ceil(logTotal / logsPerPage));
  const availableLogPages = Math.max(1, Math.ceil(logs.length / logsPerPage));
  const currentLogPage = Math.min(logPage, logPageCount);
  const visibleLogPageNumbers = getVisibleLogPageNumbers(currentLogPage, logPageCount);
  const visibleLogs = logs.slice((currentLogPage - 1) * logsPerPage, currentLogPage * logsPerPage);

  const openLogPage = async (page: number) => {
    if (page < 1 || page > logPageCount || page > availableLogPages) return;
    setLogPage(page);
    if (page < 2 || logs.length >= logTotal || prefetchInFlight.current) return;
    prefetchInFlight.current = true;
    setPrefetchingLogs(true);
    setLogPrefetchError(false);
    try {
      const next = await getEmailLogs(logs.length, Math.min(15, logTotal - logs.length), logs[0]?.requested_at || '');
      setLogs((current) => {
        const existingIds = new Set(current.map((log) => log.id));
        return [...current, ...next.logs.filter((log) => !existingIds.has(log.id))];
      });
      if (next.total !== undefined) setLogTotal(next.total);
      else if (next.logs.length === 0) setLogTotal(logs.length);
    } catch {
      setLogPrefetchError(true);
    } finally {
      prefetchInFlight.current = false;
      setPrefetchingLogs(false);
    }
  };

  if (loading) return <div role="status" aria-label="Loading email settings" aria-busy="true" className="space-y-5">
    <div className="flex items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-600"><Mail aria-hidden="true" className="h-6 w-6" /></span><div><h2 className="text-xl font-bold tracking-tight text-slate-900">Email Templates</h2><p className="mt-1 text-xs text-slate-500">Loading your templates and email settings...</p></div></div>
    <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4"><span className="h-8 w-36 rounded-lg bg-slate-200" /><span className="h-8 w-36 rounded-lg bg-slate-100" /></div><div className="divide-y divide-slate-100 px-5">{[0, 1, 2].map(row => <div key={row} className="flex items-center gap-5 py-5"><span className="h-4 w-14 rounded bg-slate-200" /><span className="h-4 flex-1 rounded bg-slate-100" /><span className="h-4 w-20 rounded bg-slate-100" /></div>)}</div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5 h-4 w-36 rounded bg-slate-200" /><div className="h-20 rounded-lg bg-slate-50" /></div>
    </div>
  </div>;

  if (editing) return (
    <div className="space-y-5">
      <button type="button" onClick={closeDesigner} className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-blue-700"><ArrowLeft className="h-4 w-4" />Back to Email Templates</button>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">{isCreating ? 'New template' : 'Edit template'}</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">{editing.template_code !== null && editing.template_code !== undefined ? `${editing.template_code} — ${editing.trigger_status === 'DONE' ? 'ACCEPT' : 'REJECT'}` : 'Design Template'}</h2>
        <p className="mt-1 text-xs text-slate-500">Design the message recipients will receive for this registration outcome.</p>
        {emailTemplateRegistrationType(editing) && <p className="mt-2 text-xs text-slate-600">Applies to: {emailTemplateRegistrationType(editing)} registrations.{emailTemplateRegistrationType(editing) !== 'COMPANY' && ' The registration details PDF is attached automatically when previewing and sending.'}</p>}
      </div>
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-12">
          <label className="text-xs font-semibold text-slate-700 md:col-span-6">Template name
            <input autoFocus value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="e.g. Standard welcome email" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          {editing.template_code !== null && editing.template_code !== undefined && <label className="text-xs font-semibold text-slate-700 md:col-span-3">{editing.trigger_status === 'DONE' ? 'Acceptance' : 'Rejection'} code
            <span className="mt-1.5 flex overflow-hidden rounded-lg border border-slate-300">
              <span className="border-r border-slate-300 bg-slate-100 px-3 py-2 font-mono font-bold text-slate-700">{editing.trigger_status === 'DONE' ? 'ACC' : 'REJ'}</span>
              <input required inputMode="numeric" pattern="[0-9]{3}" maxLength={3} value={(editing.template_code || '').slice(3)} disabled={!isCreating} onChange={(event) => setEditing({ ...editing, template_code: `${editing.trigger_status === 'DONE' ? 'ACC' : 'REJ'}${event.target.value.replace(/\D/g, '').slice(0, 3)}` })} placeholder="001" aria-label="Three-digit code number" className="min-w-0 flex-1 px-3 py-2 font-mono font-normal outline-none disabled:bg-slate-100" />
            </span>
            <span className="mt-1 block text-[11px] font-normal text-slate-500">Enter exactly three digits, for example {editing.trigger_status === 'DONE' ? 'ACC001' : 'REJ001'}.</span>
          </label>}
          <label className={`text-xs font-semibold text-slate-700 ${editing.template_code !== null && editing.template_code !== undefined ? 'md:col-span-3' : 'md:col-span-6'}`}>Trigger
            <input value={`${editing.trigger_status === 'DONE' ? 'Acceptance' : 'Rejection'}${editing.template_code !== null && editing.template_code !== undefined ? ' code' : editing.rejection_reason ? ` / ${editing.rejection_reason.replaceAll('_', ' ')}` : ' / Default'}`} disabled className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal text-slate-600" />
          </label>
          <label className="text-xs font-semibold text-slate-700 md:col-span-6">Subject
            <input value={editing.subject_template} onChange={(event) => setEditing({ ...editing, subject_template: event.target.value })} placeholder="Email subject" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700 md:col-span-3">Assigned type
            <select value={editing.registration_type || ''} onChange={(event) => setEditing({ ...editing, registration_type: (event.target.value || null) as EmailTemplate['registration_type'] })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
              <option value="">All registration types</option><option value="COMPANY">Company</option><option value="DRIVER">Driver</option><option value="TRAILER">Trailer</option><option value="VEHICLE">Vehicle</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700 md:col-span-3">Recipient
            <input value={editing.recipient_template} disabled className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-mono font-normal text-slate-600" />
          </label>
        </div>
        {editing.template_code !== null && editing.template_code !== undefined && <fieldset className="rounded-lg border border-slate-200 p-4"><legend className="px-1 text-xs font-semibold text-slate-700">Assigned ports</legend><p className="mb-3 text-[11px] text-slate-500">Choose every port that can use this code and template.</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{ports.map((port) => <label key={port.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={editing.port_ids?.includes(port.id) || false} onChange={(event) => setEditing({ ...editing, port_ids: event.target.checked ? [...(editing.port_ids || []), port.id] : (editing.port_ids || []).filter((id) => id !== port.id) })} /><span>{port.display_name}</span></label>)}</div></fieldset>}
        <div className="text-xs font-semibold text-slate-700">Email body
          <RichTextEmailEditor value={editing.body_template} onChange={(body_template) => setEditing((current) => current ? { ...current, body_template } : current)} />
          <p className="mt-1.5 text-[11px] font-normal text-slate-500">Available variables: <code>{'{{user.email}}'}</code>, <code>{'{{user.username}}'}</code>, <code>{'{{user.password}}'}</code>{editing.trigger_status === 'REJECTED' && <>, <code>{'{{rejection.reason}}'}</code></>}</p>
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
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={editing.active} disabled={editing.legacy_fallback || (!editing.template_code && !isCreating && editing.active)} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} />{editing.active ? 'Active template' : 'Use as the active template'}</label>
          <div className="flex gap-2"><button type="button" onClick={closeDesigner} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"><Save className="h-4 w-4" />{saving ? 'Saving...' : 'Save Template'}</button></div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 className="text-xl font-bold tracking-tight text-slate-900">Email Templates</h2><p className="mt-1 text-xs text-slate-500">Manage acceptance and rejection codes, then assign each code to one or more ports.</p></div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" disabled={connecting || refreshing} onClick={() => void connect()} className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{connecting ? 'Connecting...' : gmailEmail ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
          <GoogleConnectionButton email={gmailEmail} connecting={refreshing} disabled={saving || !!deletingId || connecting} connectedAction="refresh-settings" onConnect={() => void load(true)} />
        </div>
      </div>
      {loadError && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><span>{hasLoaded ? 'Showing saved settings. ' : ''}{loadError}</span><button type="button" disabled={refreshing} onClick={() => void load(true)} className="shrink-0 rounded-lg border border-amber-300 px-3 py-2 font-semibold hover:bg-amber-100 disabled:opacity-50">Retry</button></div>}
      {!hasLoaded ? <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">Email settings could not be loaded. Please retry.</p> : <>
      <section className="rounded-xl">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="ml-[0.5px] flex w-fit items-end" role="tablist" aria-label="Email template code type">
            {(['DONE', 'REJECTED'] as const).map((status) => <button key={status} type="button" role="tab" aria-selected={activeCodeTab === status} onClick={() => setActiveCodeTab(status)} className={`admin-registration-tab relative -mr-px flex h-10 min-w-[152px] items-center justify-center rounded-t-lg border px-3 text-xs font-bold uppercase tracking-wider transition-none ${activeCodeTab === status ? 'z-10 border-slate-400 border-b-transparent bg-[#CBD5E1] text-slate-900' : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900'}`}>{status === 'DONE' ? 'Acceptance codes' : 'Rejection codes'}</button>)}
          </div>
          <button type="button" onClick={() => openDesigner(newTemplate(true, activeCodeTab, true), true)} disabled={!ports.length || !apiSupportsPortCodes} aria-label={`Add ${activeCodeTab === 'DONE' ? 'acceptance' : 'rejection'} code`} className={`mb-2 inline-flex h-10 w-[132px] shrink-0 items-center justify-center gap-1 rounded-lg px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${activeCodeTab === 'DONE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}><Plus className="h-4 w-4" />Add Code</button>
        </div>
        <div role="tabpanel" className="overflow-hidden rounded-b-xl rounded-tr-xl border-x border-b border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed border-collapse text-left text-xs">
              <colgroup><col className="w-[7%]" /><col className="w-[18%]" /><col className="w-[25%]" /><col className="w-[11%]" /><col className="w-[17%]" /><col className="w-[7%]" /><col className="w-[9%]" /><col className="w-[6%]" /></colgroup>
              <thead>
                <tr className="admin-registration-table-header whitespace-nowrap border border-slate-400 bg-[#CBD5E1] text-[10px] font-bold uppercase tracking-wide text-slate-700"><th scope="col" className="px-4 py-3">Code</th><th scope="col" className="px-4 py-3">Template name</th><th scope="col" className="px-4 py-3">Subject</th><th scope="col" className="px-3 py-3 text-center">Assigned type</th><th scope="col" className="px-4 py-3 text-center">Assigned ports</th><th scope="col" className="px-3 py-3">Status</th><th scope="col" className="px-3 py-3">Updated</th><th scope="col" className="px-3 py-3 text-center">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleTemplates.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No {activeCodeTab === 'DONE' ? 'acceptance' : 'rejection'} codes yet.</td></tr> : visibleTemplates.map((template) => (
                  <tr key={template.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold text-blue-700">{template.template_code}</td>
                    <td className="px-4 py-3"><button type="button" onClick={() => openDesigner(template)} className="text-left font-semibold text-slate-900 hover:text-blue-700 hover:underline">{template.name}</button></td>
                    <td className="truncate px-4 py-3 text-slate-600" title={template.subject_template}>{template.subject_template}</td>
                    <td className="px-3 py-3 text-center text-slate-600">{emailTemplateRegistrationType(template) || 'All'}</td>
                    <td className="px-4 py-3 text-center text-slate-600" title={assignedPortNames(template, ports)}>{assignedPortNames(template, ports, true)}</td>
                    <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${template.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{template.active ? 'Active' : 'Inactive'}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-[11px] text-slate-500">{template.updated_at ? formatAdminDate(template.updated_at) : `Version ${template.version}`}</td>
                    <td className="px-2 py-3 text-center"><EmailTemplateActions template={template} deleteDisabled={deletingId === template.id || templates.length === 1 || isProtectedTemplate(template.id)} onEdit={() => openDesigner(template)} onDelete={() => void remove(template)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      {!apiSupportsPortCodes ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">The API server is still using the old single-port template format. Restart the API server (or redeploy the backend), then reload this page to manage port codes.</p> : ports.length === 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">No ports were returned by the API. Check Ports &amp; Depots and the API's Supabase connection.</p>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><h3 className="text-sm font-bold text-slate-900">Recent Email Logs</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-600"><tr><th className="px-4 py-3">Template</th><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No emails have been sent yet.</td></tr> : visibleLogs.map((log) => <tr key={log.id}><td className="px-4 py-3 font-semibold text-slate-700">{log.template_code && <span className="mr-1 font-mono text-blue-700">{log.template_code}</span>}{log.template_name}</td><td className="px-4 py-3 text-slate-700">{log.recipient}</td><td className="max-w-xs truncate px-4 py-3 text-slate-600">{log.subject}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatAdminDateTime(log.sent_at || log.requested_at)}</td><td className={`px-4 py-3 font-bold ${log.status === 'SENT' ? 'text-emerald-700' : log.status === 'FAILED' ? 'text-rose-700' : 'text-amber-700'}`}>{log.status}</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>{logTotal === 0 ? '0 emails' : `Showing ${(currentLogPage - 1) * logsPerPage + 1}–${Math.min(currentLogPage * logsPerPage, logTotal)} of ${logTotal} recent emails`}</span>
            {prefetchingLogs && <span>Loading next page…</span>}
            {logPrefetchError && currentLogPage >= 2 && <button type="button" onClick={() => void openLogPage(currentLogPage)} className="font-semibold text-blue-700 hover:underline">Could not preload next page. Retry</button>}
          </div>
          <nav className="flex items-center gap-1" aria-label="Recent email logs pagination">
            <button type="button" onClick={() => void openLogPage(currentLogPage - 1)} disabled={currentLogPage === 1} aria-label="Previous page" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">&lsaquo;</button>
            {visibleLogPageNumbers.map((page) => <button key={page} type="button" onClick={() => void openLogPage(page)} disabled={page > availableLogPages} aria-current={currentLogPage === page ? 'page' : undefined} className={`h-8 min-w-8 rounded-md px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${currentLogPage === page ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100'}`}>{page}</button>)}
            <button type="button" onClick={() => void openLogPage(currentLogPage + 1)} disabled={currentLogPage >= logPageCount || currentLogPage + 1 > availableLogPages} aria-label="Next page" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">&rsaquo;</button>
          </nav>
        </div>
      </div>
      </>}
    </div>
  );
}
