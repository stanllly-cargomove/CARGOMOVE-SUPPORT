// Offline display harness using real portal dialogs, popovers and mailbox UI.
import { useState } from 'react';
import { AdminUserCreate } from '../../src/components/admin/AdminUserCreate';
import { NorthportFileContainers } from '../../src/components/admin/NorthportFileContainers';
import { NorthportDateTimePicker } from '../../src/components/admin/NorthportDateTimePicker';
import { AutoMailInitialization } from '../../src/components/admin/AutoMailInitialization';

export function AdminDisplayProbe() {
  const [time, setTime] = useState('2026-11-12T14:00:00');
  const [form, setForm] = useState(false), [file, setFile] = useState(false);
  return <div className="space-y-4">
    <h2 className="text-xl font-bold">Display preview</h2>
    <div className="flex flex-wrap gap-3"><button className="rounded-lg border bg-white px-4 py-2 text-xs" onClick={() => setForm(true)}>Open admin form</button><button className="rounded-lg border bg-white px-4 py-2 text-xs" onClick={() => setFile(true)}>Open container file</button></div>
    <div className="w-64"><NorthportDateTimePicker value={time} disabled={false} onChange={setTime} /></div>
    {form && <AdminUserCreate onClose={() => setForm(false)} />}
    {file && <NorthportFileContainers source={{ filename: 'offline_GP.csv', token: 'offline-token', kind: 'file' }} onClose={() => setFile(false)} />}
  </div>;
}
export function AdminDisplayMailbox() {
  return <AutoMailInitialization progress={{ completed: 0, steps: [{ name: 'Offline preview', state: 'pending' }] }} error="" onRetry={() => {}} />;
}
