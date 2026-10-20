import React, { useEffect, useRef, useState } from 'react';
import { Camera, KeyRound, LoaderCircle, MoreVertical, ShieldCheck, Trash2, X } from 'lucide-react';
import type { ApplicationUser } from '../../services/auth';
import { notifyError, notifySuccess } from '../common/notifications';

export function ProfileAvatar({ url, name, className = '' }: { url?: string | null; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sky-100 font-semibold text-sky-700 ${className}`}>
    {url && !failed ? <img src={url} alt={`${name}'s profile`} className="h-full w-full object-cover" onError={() => setFailed(true)} /> : name.slice(0, 2).toUpperCase()}
  </span>;
}

export async function profileRequest(method = 'GET', image?: string): Promise<string | null> {
  const result = await fetch('/api/auth/profile', { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify({ image }) }) });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(body.error || 'Unable to update profile picture.');
  return body.avatar_url || null;
}

const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';

export function AccountSettings({ user, avatarUrl, onAvatarChange, onUserChange, onReset, sendingReset }: { user: ApplicationUser | null; avatarUrl: string | null; onAvatarChange: (url: string | null) => void; onUserChange?: (user: ApplicationUser) => void; onReset: () => void; sendingReset: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const usernameDialog = useRef<HTMLDialogElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 256, height: 256 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [isCardMenuOpen, setIsCardMenuOpen] = useState(false);
  const [editingUsername, setEditingUsername] = useState(user?.username || '');
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const name = user?.username || user?.full_name || user?.email?.split('@')[0] || 'Admin';
  const scale = Math.max(256 / size.width, 256 / size.height) * zoom;
  const width = size.width * scale, height = size.height * scale;
  const maxX = Math.max(0, (width - 256) / 2), maxY = Math.max(0, (height - 256) / 2);
  const x = Math.max(-maxX, Math.min(maxX, offset.x)), y = Math.max(-maxY, Math.min(maxY, offset.y));
  useEffect(() => { if (source) dialog.current?.showModal(); }, [source]);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  const close = () => { if (busy) return; dialog.current?.close(); setSource(null); input.current?.focus(); };
  const choose = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { notifyError('Choose a JPG, PNG or WebP image up to 10 MB.'); return; }
    setZoom(1); setOffset({ x: 0, y: 0 }); setSource(URL.createObjectURL(file));
  };
  const save = async () => {
    if (!image.current?.complete || !image.current.naturalWidth || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Image cropping is unavailable.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 512, 512); context.scale(512 / 256, 512 / 256);
      context.drawImage(image.current, (256 - width) / 2 + x, (256 - height) / 2 + y, width, height);
      onAvatarChange(await profileRequest('POST', canvas.toDataURL('image/jpeg', 0.88)));
      dialog.current?.close(); setSource(null); notifySuccess('Profile picture updated.');
    } catch (error) { notifyError(error instanceof Error ? error.message : 'Unable to upload photo.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { onAvatarChange(await profileRequest('DELETE')); notifySuccess('Profile picture removed.'); }
    catch (error) { notifyError(error instanceof Error ? error.message : 'Unable to remove photo.'); }
    finally { setBusy(false); }
  };
  const saveUsername = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || isSavingUsername) return;
    setIsSavingUsername(true);
    try {
      const result = await fetch('/api/auth/profile', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: editingUsername }) });
      const body = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(body.error || 'Unable to update username.');
      onUserChange?.({ ...user, username: body.username });
      usernameDialog.current?.close();
      notifySuccess('Username updated.');
    } catch (error) { notifyError(error instanceof Error ? error.message : 'Unable to update username.'); }
    finally { setIsSavingUsername(false); }
  };
  return <div className="w-full space-y-6">
    <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600">Your workspace account</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Account settings</h2><p className="mt-2 text-xs text-slate-500">Manage your profile picture and account security.</p></div>
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <span className="absolute right-6 top-5 z-10 rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold text-sky-700 shadow-sm backdrop-blur-sm">Administrator</span>
      <div className="absolute right-6 top-16 z-20">
        <button type="button" aria-label="Account card actions" aria-expanded={isCardMenuOpen} onClick={() => setIsCardMenuOpen(open => !open)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"><MoreVertical className="h-5 w-5" /></button>
        {isCardMenuOpen && <div className="absolute right-0 mt-2 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"><button type="button" className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => { setEditingUsername(user?.username || ''); setIsCardMenuOpen(false); usernameDialog.current?.showModal(); }}>Change username</button></div>}
      </div>
      <div className="h-20 bg-gradient-to-r from-sky-100 via-blue-50 to-slate-50" />
      <div className="px-6 pb-6"><div className="-mt-9 flex items-end">
        <div className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-full border-4 border-white shadow-sm focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2">
          <ProfileAvatar url={avatarUrl} name={name} className="h-full w-full text-2xl" />
          <div className="absolute inset-0 flex flex-col bg-slate-950/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button type="button" disabled={busy} aria-label={avatarUrl ? 'Change profile photo' : 'Upload profile photo'} className="flex flex-1 items-center justify-center gap-1 text-[10px] font-semibold text-white hover:bg-white/10 disabled:opacity-50" onClick={() => input.current?.click()}><Camera className="h-4 w-4" />{avatarUrl ? 'Change' : 'Upload'}</button>
            {avatarUrl && <button type="button" disabled={busy} aria-label="Remove profile photo" className="flex flex-1 items-center justify-center gap-1 border-t border-white/20 text-[10px] font-semibold text-white hover:bg-rose-500/30 disabled:opacity-50" onClick={() => void remove()}><Trash2 className="h-3.5 w-3.5" />Remove</button>}
          </div>
        </div>
        <input ref={input} type="file" aria-label="Choose profile picture" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
        <h3 className="mt-4 text-lg font-bold text-slate-900">{name}</h3><p className="mt-1 break-all text-xs text-slate-500">{user?.email}</p>
      </div>
    </section>
    <section className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-sky-600" /><div><h3 className="text-sm font-bold text-slate-900">Account security</h3><p className="mt-1 text-xs leading-5 text-slate-500">Send a secure password reset link to your account email.</p></div></div><button type="button" onClick={onReset} disabled={!user?.email || sendingReset} className={button + ' w-full shrink-0 sm:w-auto'}><KeyRound className="h-4 w-4" />{sendingReset ? 'Sending reset link…' : 'Email me a password reset link'}</button></section>
    <dialog ref={usernameDialog} aria-labelledby="username-dialog-title" className="m-auto w-[min(400px,calc(100vw-24px))] max-w-none rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/60">
      <form onSubmit={event => void saveUsername(event)}>
        <div className="flex items-center justify-between"><h3 id="username-dialog-title" className="text-base font-bold">Change username</h3><button type="button" aria-label="Close username editor" disabled={isSavingUsername} className="rounded-lg p-2 hover:bg-slate-100" onClick={() => usernameDialog.current?.close()}><X className="h-4 w-4" /></button></div>
        <label className="mt-5 block text-xs font-semibold text-slate-700">Username<input autoFocus required minLength={3} maxLength={64} pattern="[a-z0-9._-]+" value={editingUsername} onChange={event => setEditingUsername(event.target.value.toLowerCase())} className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>
        <p className="mt-2 text-[11px] text-slate-500">Use lowercase letters, numbers, dots, underscores or hyphens.</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className={button} disabled={isSavingUsername} onClick={() => usernameDialog.current?.close()}>Cancel</button><button type="submit" disabled={isSavingUsername || editingUsername.trim() === user?.username} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{isSavingUsername && <LoaderCircle className="h-4 w-4 animate-spin" />}{isSavingUsername ? 'Saving…' : 'Save username'}</button></div>
      </form>
    </dialog>
    <dialog ref={dialog} aria-labelledby="crop-title" className="m-auto w-[min(420px,calc(100vw-24px))] max-w-none max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/60" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="mb-4 flex items-center justify-between"><h3 id="crop-title" className="font-bold">Crop profile picture</h3><button type="button" aria-label="Close photo editor" disabled={busy} className="rounded-lg p-2 hover:bg-slate-100" onClick={close}><X className="h-4 w-4" /></button></div>
      <p className="mb-4 text-xs text-slate-500">Drag to reposition. Use the sliders to adjust your crop.</p>
      <div className="relative mx-auto h-[256px] w-[256px] max-w-full touch-none overflow-hidden bg-slate-100" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, left: x, top: y }; }} onPointerMove={event => { if (drag.current && !busy) setOffset({ x: Math.max(-maxX, Math.min(maxX, drag.current.left + event.clientX - drag.current.x)), y: Math.max(-maxY, Math.min(maxY, drag.current.top + event.clientY - drag.current.y)) }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {source && <img ref={image} src={source} alt="Photo crop preview" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ width, height, left: (256 - width) / 2 + x, top: (256 - height) / 2 + y }} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => { notifyError('This image could not be opened. Choose another photo.'); close(); }} />}
        <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/90 shadow-[0_0_0_50px_rgba(15,23,42,0.45)]" />
      </div>
      <div className="mt-4 space-y-3">{[{ label: 'Zoom', min: 1, max: 3, value: zoom, change: (v: number) => { setZoom(v); setOffset({ x: 0, y: 0 }); } }, { label: 'Horizontal position', min: -maxX, max: maxX, value: x, change: (v: number) => setOffset({ x: v, y }) }, { label: 'Vertical position', min: -maxY, max: maxY, value: y, change: (v: number) => setOffset({ x, y: v }) }].map(control => <label key={control.label} className="flex items-center gap-3 text-xs text-slate-600"><span className="w-28 shrink-0">{control.label}</span><input type="range" min={control.min} max={control.max} step="0.01" value={control.value} disabled={busy || control.min === control.max} onChange={event => control.change(Number(event.target.value))} className="min-w-0 flex-1 accent-blue-600" /></label>)}</div>
      <div className="mt-5 flex justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={close}>Cancel</button><button type="button" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? 'Saving…' : 'Save photo'}</button></div>
    </dialog>
  </div>;
}
