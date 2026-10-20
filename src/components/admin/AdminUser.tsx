import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Ellipsis, KeyRound, LoaderCircle, Mail, Phone, Plus, Search, UsersRound, X } from 'lucide-react';
import { AdminAccount, getAdminUsers } from '../../services/auth';
import { browserSupabaseAuth } from '../../services/supabaseAuth';
import { notifyError, notifySuccess } from '../common/notifications';
import { ProfileAvatar } from './AccountSettings';
import { AdminUserCreate } from './AdminUserCreate';

const PAGE_SIZE = 10;

export function AdminUser() {
  const [users, setUsers] = useState<AdminAccount[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    void getAdminUsers().then((adminUsers) => {
      if (!mounted) return;
      setUsers(adminUsers);
      setLoadError('');
    }).catch((error) => {
      if (!mounted) return;
      setUsers([]);
      setLoadError(error instanceof Error ? error.message : 'Unable to load admin users.');
    }).finally(() => {
      if (mounted) setIsLoading(false);
    });
    return () => { mounted = false; };
  }, [isAddUserOpen]);

  useEffect(() => {
    if (!selectedUser) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedUser(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [selectedUser]);

  const filteredUsers = users.filter((user) => {
    const term = searchTerm.trim().toLowerCase();
    return !term || [user.username, user.email, user.full_name, user.mobile_number]
      .some((value) => (value || '').toLowerCase().includes(term));
  });
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const visibleUsers = filteredUsers.slice(startIndex, startIndex + PAGE_SIZE);
  const firstPageNumber = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const pageNumbers = Array.from({ length: Math.min(totalPages, 5) }, (_, index) => firstPageNumber + index);

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      notifySuccess('Email address copied.');
    } catch {
      notifyError('Unable to copy the email address.');
    }
  };

  const sendPasswordReset = async (email: string) => {
    if (isSendingReset) return;
    if (!browserSupabaseAuth) {
      notifyError('Password reset is not configured.');
      return;
    }
    setIsSendingReset(true);
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await browserSupabaseAuth.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      notifySuccess(`Password reset link sent to ${email}.`);
      setSelectedUser(null);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to send the password reset email.');
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Admin Users</h2>
        <p className="mt-1 text-xs text-slate-500">Manage administrator accounts for the CargoMove portal.</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => { setSearchTerm(event.target.value); setCurrentPage(1); }}
            placeholder="Search username, name, email or mobile..."
            aria-label="Search admin users"
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs text-slate-700 focus:border-[#0095e8] focus:outline-none focus:ring-2 focus:ring-sky-100"
          />
        </div>
        <button type="button" onClick={() => setIsAddUserOpen(true)} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0095e8] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#0078c8]">
          <Plus className="h-4 w-4" /> Add User
        </button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Admin users table">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="admin-registration-table-header border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-5 py-2.5">Username</th>
                <th scope="col" className="px-5 py-2.5">Full Name</th>
                <th scope="col" className="px-5 py-2.5">Email Address</th>
                <th scope="col" className="px-5 py-2.5">Mobile Number</th>
                <th scope="col" className="px-5 py-2.5">Status</th>
                <th scope="col" className="w-20 px-5 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-xs text-slate-500">Loading admin users...</td></tr>
              ) : loadError ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-xs text-rose-600">{loadError}</td></tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-xs text-slate-500">
                    <UsersRound className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                    No admin users found.
                  </td>
                </tr>
              ) : visibleUsers.map((user) => (
                <tr key={user.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-3">
                      <ProfileAvatar url={user.avatar_url} name={user.full_name || user.username} className="h-8 w-8 text-xs" />
                      <span className="font-semibold text-slate-900">{user.username}</span>
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-slate-700">{user.full_name || '—'}</td>
                  <td className="px-5 py-2.5">
                    <a href={`mailto:${user.email}`} className="inline-flex items-center gap-2 whitespace-nowrap text-[#0078c8] hover:underline">
                      <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />{user.email}
                    </a>
                  </td>
                  <td className="px-5 py-2.5 text-slate-700">
                    {user.mobile_number ? <a href={`tel:${user.mobile_number}`} className="inline-flex items-center gap-2 whitespace-nowrap hover:text-[#0078c8]"><Phone className="h-4 w-4 shrink-0 text-[#0095e8]" aria-hidden="true" />{user.mobile_number}</a> : '—'}
                  </td>
                  <td className="px-5 py-2.5"><span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Active</span></td>
                  <td className="px-5 py-2.5 text-center">
                    <button type="button" onClick={() => setSelectedUser(user)} aria-label={`Actions for ${user.username}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-[#0095e8]">
                      <Ellipsis className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>{filteredUsers.length ? `Showing ${startIndex + 1} to ${startIndex + visibleUsers.length} of ${filteredUsers.length} users` : 'Showing 0 users'}</span>
          <nav className="flex items-center gap-2" aria-label="Admin users pagination">
            <button type="button" onClick={() => setCurrentPage(Math.max(1, safePage - 1))} disabled={safePage === 1} aria-label="Previous page" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            {pageNumbers.map((page) => (
              <button key={page} type="button" onClick={() => setCurrentPage(page)} aria-label={`Page ${page}`} aria-current={safePage === page ? 'page' : undefined} className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-semibold ${safePage === page ? 'bg-blue-600 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{page}</button>
            ))}
            <button type="button" onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages} aria-label="Next page" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </nav>
        </div>
      </section>

      {selectedUser && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onClick={() => setSelectedUser(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="admin-user-actions-title" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="admin-user-actions-title" className="text-base font-semibold text-slate-900">{selectedUser.username}</h3>
                <p className="mt-1 truncate text-xs text-slate-500">{selectedUser.email}</p>
              </div>
              <button type="button" onClick={() => setSelectedUser(null)} aria-label="Close user actions" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => void copyEmail(selectedUser.email)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"><Copy className="h-4 w-4 text-slate-500" />Copy email address</button>
              <button type="button" onClick={() => void sendPasswordReset(selectedUser.email)} disabled={isSendingReset} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">{isSendingReset ? <LoaderCircle className="h-4 w-4 animate-spin text-slate-500" /> : <KeyRound className="h-4 w-4 text-slate-500" />}{isSendingReset ? 'Sending reset link...' : 'Send password reset link'}</button>
            </div>
          </section>
        </div>
      )}
      {isAddUserOpen && <AdminUserCreate onClose={() => setIsAddUserOpen(false)} />}
    </div>
  );
}
