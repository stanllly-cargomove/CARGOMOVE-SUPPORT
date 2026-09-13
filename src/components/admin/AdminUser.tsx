import React, { useEffect, useState } from 'react';
import { Plus, Search, UsersRound } from 'lucide-react';
import { getAdminUsers, AdminAccount } from '../../services/auth';
import { AdminUserCreate } from './AdminUserCreate';

export function AdminUser() {
  const [users, setUsers] = useState<AdminAccount[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void getAdminUsers().then((adminUsers) => {
      if (isMounted) setUsers(adminUsers);
    }).catch(() => {
      if (isMounted) setUsers([]);
    });
    return () => { isMounted = false; };
  }, [isAddUserOpen]);

  const filteredUsers = users.filter((user) => {
    const term = searchTerm.toLowerCase();
    return !term || [user.username, user.email, user.full_name, user.mobile_number]
      .some((value) => value.toLowerCase().includes(term));
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Admin user</h2>
          <p className="text-xs text-slate-500 mt-1">Manage administrator accounts for the Cargomove portal.</p>
        </div>
        <button type="button" onClick={() => setIsAddUserOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative max-w-md">
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search username, email, name or mobile..."
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
                <th className="py-3 px-4">Full name</th>
                <th className="py-3 px-4">Mobile number</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-slate-500">
                    <UsersRound className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    No admin users found.
                  </td>
                </tr>
              ) : filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 font-semibold text-slate-900">{user.username}</td>
                  <td className="py-3 px-4 text-slate-700">{user.email}</td>
                  <td className="py-3 px-4 text-slate-700">{user.full_name}</td>
                  <td className="py-3 px-4 text-slate-700">{user.mobile_number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isAddUserOpen && <AdminUserCreate onClose={() => setIsAddUserOpen(false)} />}
    </div>
  );
}
