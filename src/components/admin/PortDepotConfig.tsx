import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DepotConfig, PortConfig } from '../../types';
import { deleteDepotConfig, deletePortConfig, getDepots, getPorts, saveDepot as persistDepot, savePort as persistPort, updateDepotConfig, updatePortConfig } from '../../services/storage';
import { Anchor, Building2, Check, Edit2, MoreVertical, Plus, X } from 'lucide-react';
import { notifySuccess, notifyWarning } from '../common/notifications';

export function PortDepotConfig() {
  const [ports, setPorts] = useState<PortConfig[]>(getPorts());
  const [depots, setDepots] = useState<DepotConfig[]>(getDepots());
  const [editingPortId, setEditingPortId] = useState<string | null>(null);
  const [editingDepotId, setEditingDepotId] = useState<string | null>(null);
  const [portForm, setPortForm] = useState({ display_name: '', backend_port_id: '' });
  const [depotForm, setDepotForm] = useState({ display_name: '', backend_depot_id: '' });
  const [isAddingPort, setIsAddingPort] = useState(false);
  const [isAddingDepot, setIsAddingDepot] = useState(false);
  const [newPort, setNewPort] = useState({ display_name: '', location: 'OTHER' as PortConfig['location'], backend_port_id: '' });
  const [newDepot, setNewDepot] = useState({ display_name: '', port_id: '', backend_depot_id: '' });
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ type: 'port' | 'depot'; id: string; name: string } | null>(null);

  const refresh = () => {
    setPorts(getPorts());
    setDepots(getDepots());
  };

  const startPortEdit = (port: PortConfig) => {
    setEditingDepotId(null);
    setEditingPortId(port.id);
    setPortForm({ display_name: port.display_name, backend_port_id: port.backend_port_id });
  };

  const startDepotEdit = (depot: DepotConfig) => {
    setEditingPortId(null);
    setEditingDepotId(depot.id);
    setDepotForm({ display_name: depot.display_name, backend_depot_id: depot.backend_depot_id });
  };

  const savePort = (portId: string) => {
    updatePortConfig(portId, {
      display_name: portForm.display_name.trim(),
      backend_port_id: portForm.backend_port_id.trim(),
    });
    setEditingPortId(null);
    refresh();
  };

  const saveDepot = (depotId: string) => {
    updateDepotConfig(depotId, {
      display_name: depotForm.display_name.trim(),
      backend_depot_id: depotForm.backend_depot_id.trim(),
    });
    setEditingDepotId(null);
    refresh();
  };

  const addPort = () => {
    const name = newPort.display_name.trim();
    if (!name) {
      notifyWarning('Port name is required.');
      return;
    }
    const id = `port-${Date.now()}`;
    persistPort({ id, location: newPort.location, display_name: name, code: name.toUpperCase().replace(/[^A-Z0-9]+/g, '-'), backend_port_id: newPort.backend_port_id.trim(), active: true });
    setNewPort({ display_name: '', location: 'OTHER', backend_port_id: '' });
    setIsAddingPort(false);
    refresh();
    notifySuccess('Port added successfully.');
  };

  const addDepot = () => {
    const name = newDepot.display_name.trim();
    if (!name || !newDepot.port_id) {
      notifyWarning('Depot name and associated port are required.');
      return;
    }
    persistDepot({ id: `depot-${Date.now()}`, port_id: newDepot.port_id, display_name: name, backend_depot_id: newDepot.backend_depot_id.trim(), active: true });
    setNewDepot({ display_name: '', port_id: '', backend_depot_id: '' });
    setIsAddingDepot(false);
    refresh();
    notifySuccess('Depot added successfully.');
  };

  const removePort = (port: PortConfig) => {
    if (!deletePortConfig(port.id)) {
      notifyWarning('Remove the associated depots before removing this port.');
      return;
    }
    refresh();
    notifySuccess('Port removed.');
  };

  const removeDepot = (depot: DepotConfig) => {
    deleteDepotConfig(depot.id);
    refresh();
    notifySuccess('Depot removed.');
  };

  const portNames = new Map(ports.map((port) => [port.id, port.display_name]));

  const confirmRemoval = () => {
    if (!pendingRemoval) return;
    if (pendingRemoval.type === 'port') {
      removePort(ports.find((port) => port.id === pendingRemoval.id)!);
    } else {
      removeDepot(depots.find((depot) => depot.id === pendingRemoval.id)!);
    }
    setPendingRemoval(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Port & Depot Master Configuration</h2>
        <p className="text-xs text-slate-500 mt-1">Manage the human-readable names and backend export IDs used by the registration system.</p>
      </div>

      <ConfigTable
        title="Ports"
        description="Backend values exported to the PORTS column."
        count={ports.length}
        icon={<Anchor className="w-4 h-4 text-blue-600" />}
        headers={['Port', 'Location', 'Internal Key', "Cargomove's Port ID", '']}
        action={<button type="button" onClick={() => { setIsAddingPort((adding) => !adding); setIsAddingDepot(false); }} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700"><Plus className="w-3.5 h-3.5" /> Add port</button>}
      >
        {isAddingPort && <AddPortRow form={newPort} onChange={setNewPort} onSave={addPort} onCancel={() => setIsAddingPort(false)} />}
        {ports.map((port) => {
          const editing = editingPortId === port.id;
          return (
            <tr key={port.id} className="hover:bg-slate-50/70">
              <td className="px-3 py-2 font-semibold text-slate-900 min-w-48">
                {editing ? <input value={portForm.display_name} onChange={(event) => setPortForm({ ...portForm, display_name: event.target.value })} className="w-full rounded border border-slate-300 px-2 py-1.5" /> : port.display_name}
              </td>
              <td className="px-2 py-2 text-slate-600">{formatLocation(port.location)}</td>
              <td className="px-2 py-2 font-mono text-[11px] text-slate-500">{port.id}</td>
              <td className="px-2 py-2 font-mono font-semibold text-blue-700 min-w-56">
                {editing ? <input value={portForm.backend_port_id} onChange={(event) => setPortForm({ ...portForm, backend_port_id: event.target.value })} className="w-full rounded border border-slate-300 px-2 py-1.5" /> : port.backend_port_id}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {editing ? <RowActions onSave={() => savePort(port.id)} onCancel={() => setEditingPortId(null)} /> : <ActionMenu isOpen={openActionId === port.id} onToggle={() => setOpenActionId(openActionId === port.id ? null : port.id)} onClose={() => setOpenActionId(null)} onEdit={() => { setOpenActionId(null); startPortEdit(port); }} onRemove={() => { setOpenActionId(null); setPendingRemoval({ type: 'port', id: port.id, name: port.display_name }); }} />}
              </td>
            </tr>
          );
        })}
      </ConfigTable>

      <ConfigTable
        title="Depots & Staging Yards"
        description="Backend values exported to the DEPOTS column."
        count={depots.length}
        icon={<Building2 className="w-4 h-4 text-emerald-600" />}
        headers={['Depot', 'Associated Port', 'Internal Key', 'Backend Depot ID', '']}
        action={<button type="button" onClick={() => { setIsAddingDepot((adding) => !adding); setIsAddingPort(false); setNewDepot((current) => ({ ...current, port_id: current.port_id || ports[0]?.id || '' })); }} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700"><Plus className="w-3.5 h-3.5" /> Add depot</button>}
      >
        {isAddingDepot && <AddDepotRow form={newDepot} ports={ports} onChange={setNewDepot} onSave={addDepot} onCancel={() => setIsAddingDepot(false)} />}
        {depots.map((depot) => {
          const editing = editingDepotId === depot.id;
          return (
            <tr key={depot.id} className="hover:bg-slate-50/70">
              <td className="px-3 py-2 font-semibold text-slate-900 min-w-56">
                {editing ? <input value={depotForm.display_name} onChange={(event) => setDepotForm({ ...depotForm, display_name: event.target.value })} className="w-full rounded border border-slate-300 px-2 py-1.5" /> : depot.display_name}
              </td>
              <td className="px-2 py-2 text-slate-600">{portNames.get(depot.port_id) || depot.port_id}</td>
              <td className="px-2 py-2 font-mono text-[11px] text-slate-500">{depot.id}</td>
              <td className="px-2 py-2 font-mono font-semibold text-emerald-700 min-w-56">
                {editing ? <input value={depotForm.backend_depot_id} onChange={(event) => setDepotForm({ ...depotForm, backend_depot_id: event.target.value })} className="w-full rounded border border-slate-300 px-2 py-1.5" /> : depot.backend_depot_id}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {editing ? <RowActions onSave={() => saveDepot(depot.id)} onCancel={() => setEditingDepotId(null)} /> : <ActionMenu isOpen={openActionId === depot.id} onToggle={() => setOpenActionId(openActionId === depot.id ? null : depot.id)} onClose={() => setOpenActionId(null)} onEdit={() => { setOpenActionId(null); startDepotEdit(depot); }} onRemove={() => { setOpenActionId(null); setPendingRemoval({ type: 'depot', id: depot.id, name: depot.display_name }); }} />}
              </td>
            </tr>
          );
        })}
      </ConfigTable>
      {pendingRemoval && <RemovalConfirmation name={pendingRemoval.name} onCancel={() => setPendingRemoval(null)} onConfirm={confirmRemoval} />}
    </div>
  );
}

function ConfigTable({
  title,
  description,
  count,
  icon,
  headers,
  action,
  children,
}: {
  title: string;
  description: string;
  count: number;
  icon: React.ReactNode;
  headers: string[];
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          {icon}
          <div><h3 className="text-sm font-bold text-slate-900">{title}</h3><p className="text-[11px] text-slate-500">{description}</p></div>
        </div>
        <div className="flex items-center gap-2"><span className="text-[11px] font-semibold text-slate-400">{count} configured</span>{action}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <tr>{headers.map((header) => <th key={header || 'action'} className="px-3 py-2.5 font-bold first:pl-4 last:pr-4">{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">{children}</tbody>
        </table>
      </div>
    </section>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-100"><Edit2 className="w-3.5 h-3.5" /> Edit</button>;
}

function formatLocation(location: PortConfig['location']) {
  return location === 'PORT_KLANG' ? 'Port Klang' : location === 'JOHOR' ? 'Johor' : 'Other';
}

function ActionMenu({
  isOpen,
  onToggle,
  onClose,
  onEdit,
  onRemove,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !menuRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 4;
    const belowTop = triggerRect.bottom + gap;
    const top = belowTop + menuRect.height <= window.innerHeight - viewportPadding
      ? belowTop
      : Math.max(viewportPadding, triggerRect.top - menuRect.height - gap);
    const left = Math.min(
      Math.max(viewportPadding, triggerRect.right - menuRect.width),
      window.innerWidth - menuRect.width - viewportPadding,
    );

    setPosition({ top, left });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleViewportChange = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const popup = isOpen && typeof document !== 'undefined'
    ? createPortal(
      <>
        <button type="button" tabIndex={-1} aria-label="Close actions" className="fixed inset-0 z-[70] h-full w-full cursor-default bg-transparent" onClick={onClose} />
        <div
          ref={menuRef}
          role="menu"
          style={{ top: position.top, left: position.left }}
          className="fixed z-[80] w-32 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-xl"
        >
          <button type="button" role="menuitem" onClick={onEdit} className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
          <button type="button" role="menuitem" onClick={onRemove} className="w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50">Remove</button>
        </div>
      </>,
      document.body,
    )
    : null;

  return <div className="relative inline-block text-left">
    <button ref={triggerRef} type="button" onClick={onToggle} aria-label="Open actions" aria-haspopup="menu" aria-expanded={isOpen} title="Actions" className={`rounded-md p-1.5 ${isOpen ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}><MoreVertical className="w-4 h-4" /></button>
    {popup}
  </div>;
}

function RemovalConfirmation({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
    <div role="dialog" aria-modal="true" aria-labelledby="remove-config-title" className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
      <h3 id="remove-config-title" className="text-base font-bold text-slate-900">Remove {name}?</h3>
      <p className="mt-2 text-xs leading-5 text-slate-500">This configuration will be removed from the master list and will no longer be available for new registrations.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        <button type="button" onClick={onConfirm} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-700">Remove</button>
      </div>
    </div>
  </div>;
}

type NewPortForm = { display_name: string; location: PortConfig['location']; backend_port_id: string };
type NewDepotForm = { display_name: string; port_id: string; backend_depot_id: string };

function AddPortRow({
  form,
  onChange,
  onSave,
  onCancel,
}: {
  form: NewPortForm;
  onChange: (form: NewPortForm) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return <tr className="bg-blue-50/50">
    <td className="px-4 py-2"><input autoFocus placeholder="Port name" value={form.display_name} onChange={(event) => onChange({ ...form, display_name: event.target.value })} className="w-full rounded border border-blue-200 px-2 py-1.5" /></td>
    <td className="px-3 py-2"><select value={form.location} onChange={(event) => onChange({ ...form, location: event.target.value as PortConfig['location'] })} className="rounded border border-blue-200 bg-white px-2 py-1.5"><option value="PORT_KLANG">Port Klang</option><option value="JOHOR">Johor</option><option value="OTHER">Other</option></select></td>
    <td className="px-3 py-2 text-slate-400">Generated on save</td>
    <td className="px-3 py-2"><input placeholder="Optional backend ID" value={form.backend_port_id} onChange={(event) => onChange({ ...form, backend_port_id: event.target.value })} className="w-full rounded border border-blue-200 px-2 py-1.5 font-mono" /></td>
    <td className="px-4 py-2 text-right"><RowActions onSave={onSave} onCancel={onCancel} /></td>
  </tr>;
}

function AddDepotRow({
  form,
  ports,
  onChange,
  onSave,
  onCancel,
}: {
  form: NewDepotForm;
  ports: PortConfig[];
  onChange: (form: NewDepotForm) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return <tr className="bg-emerald-50/50">
    <td className="px-4 py-2"><input autoFocus placeholder="Depot name" value={form.display_name} onChange={(event) => onChange({ ...form, display_name: event.target.value })} className="w-full rounded border border-emerald-200 px-2 py-1.5" /></td>
    <td className="px-3 py-2"><select value={form.port_id} onChange={(event) => onChange({ ...form, port_id: event.target.value })} className="rounded border border-emerald-200 bg-white px-2 py-1.5">{ports.map((port) => <option key={port.id} value={port.id}>{port.display_name}</option>)}</select></td>
    <td className="px-3 py-2 text-slate-400">Generated on save</td>
    <td className="px-3 py-2"><input placeholder="Optional backend ID" value={form.backend_depot_id} onChange={(event) => onChange({ ...form, backend_depot_id: event.target.value })} className="w-full rounded border border-emerald-200 px-2 py-1.5 font-mono" /></td>
    <td className="px-4 py-2 text-right"><RowActions onSave={onSave} onCancel={onCancel} /></td>
  </tr>;
}

function RowActions({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return <div className="flex justify-end gap-1.5"><button type="button" onClick={onSave} title="Save" className="p-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"><Check className="w-3.5 h-3.5" /></button><button type="button" onClick={onCancel} title="Cancel" className="p-1.5 rounded-md border border-slate-300 text-slate-500 hover:bg-slate-100"><X className="w-3.5 h-3.5" /></button></div>;
}
