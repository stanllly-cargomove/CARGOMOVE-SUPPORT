import React, { useEffect, useRef, useState } from 'react';
import { NotificationToaster } from '../common/NotificationToaster';
import {
  LayoutDashboard,
  Building2,
  Inbox,
  Settings,
  BookOpen,
  Wrench,
  Info,
  Container,
  UserRoundPlus,
  ChevronDown,
  RefreshCw,
  Mail,
  Clock3,
  CircleCheck,
  CircleX,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Home,
  ChevronRight as BreadcrumbChevronRight,
  MoreVertical,
  BadgeCheck,
  KeyRound,
} from 'lucide-react';
import { AdminDashboard } from './AdminDashboard';
import { CompanyMaster } from './CompanyMaster';
import { SubmissionsList } from './SubmissionsList';
import { PortDepotConfig } from './PortDepotConfig';
import { SchemaMappingInspector } from './SchemaMappingInspector';
import { GuidelineManager } from './GuidelineManager';
import { UserRegistration } from './UserRegistration';
import { AdminUser } from './AdminUser';
import { EmailTemplateManager } from './EmailTemplateManager';
import { DeveloperSettings } from './DeveloperSettings';
import { SystemVersion } from './SystemVersion';
import { CargoMoveScheduler } from './CargoMoveScheduler';
import { AutoRegisterCmPage } from './AutoRegisterCm';
import { NorthportRecovery } from './NorthportRecovery';
import { AutoMail } from './AutoMail';
import { AutoEmailConfig } from './AutoEmailConfig';
import { AccountSettings, ProfileAvatar, profileRequest } from './AccountSettings';
import { notifyError, notifySuccess } from '../common/notifications';
import { RegistrationType } from '../../types';
import { getSubmissions, subscribeToStorage } from '../../services/storage';
import { ApplicationUser, getExternalUserAccess, subscribeToExternalUserAccess } from '../../services/auth';
import { browserSupabaseAuth } from '../../services/supabaseAuth';

interface AdminLayoutProps {
  active?: boolean;
  user: ApplicationUser | null;
  onSwitchToCustomer: () => void;
  onRefreshData: () => Promise<void>;
  onLogout: () => void;
  onUserChange: (user: ApplicationUser) => void;
}

export function AdminLayout({ user, onSwitchToCustomer, onRefreshData, onLogout, onUserChange, active = true }: AdminLayoutProps) {
  const [activeTab, setActiveTab] = useState<string>(() => user?.type === 'ADMIN' && (new URLSearchParams(window.location.search).get('auto_mail') === 'connected' || window.location.hash === '#auto-mail/signatures') ? 'auto-mail' : 'dashboard');
  const openAutoEmailConfig = () => { setPortalMode('developer'); setActiveTab('auto-email-config'); setIsMobileSidebarOpen(false);
  };
  const [hasOpenedNorthport, setHasOpenedNorthport] = useState(false);
  useEffect(() => { if (activeTab === 'northport-recovery') setHasOpenedNorthport(true); }, [activeTab]);
  const [portalMode, setPortalMode] = useState<'admin' | 'developer'>('admin');
  const [isRegistrationQueueExpanded, setIsRegistrationQueueExpanded] = useState(false);
  const [queueRegistrationType, setQueueRegistrationType] = useState<RegistrationType>('COMPANY');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dataRefreshVersion, setDataRefreshVersion] = useState(0);
  const [mailBreadcrumbs,setMailBreadcrumbs]=useState<string[]>(['Inbox']);
  const breadcrumbRef=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(activeTab==='auto-mail'&&breadcrumbRef.current)breadcrumbRef.current.scrollLeft=breadcrumbRef.current.scrollWidth;},[activeTab,mailBreadcrumbs]);
  const [emailTemplateView, setEmailTemplateView] = useState<'list' | 'design'>('list');
  const [pendingSubmissionCount, setPendingSubmissionCount] = useState(0);
  const [pendingUserCount, setPendingUserCount] = useState(0);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setAvatarUrl(null);
    void profileRequest().then(url => { if (active) setAvatarUrl(url); }).catch(() => {});
    return () => { active = false; };
  }, [user?.email]);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setIsAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAccountMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isAccountMenuOpen]);

  useEffect(() => {
    let disposed = false;
    const refreshPendingCounts = () => {
      setPendingSubmissionCount(getSubmissions().filter((submission) => submission.status === 'PENDING').length);
      void getExternalUserAccess()
        .then((users) => {
          if (!disposed) setPendingUserCount(users.filter((user) => user.status === 'PENDING').length);
        })
        .catch(() => {
          if (!disposed) setPendingUserCount(0);
        });
    };

    const unsubscribeStorage = subscribeToStorage(refreshPendingCounts);
    const unsubscribeUsers = subscribeToExternalUserAccess(refreshPendingCounts);
    refreshPendingCounts();
    return () => {
      disposed = true;
      unsubscribeStorage();
      unsubscribeUsers();
    };
  }, []);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefreshData();
      setDataRefreshVersion(version => version + 1);
      notifySuccess('Latest database data loaded.');
    } catch {
      notifyError('Unable to check for new data.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email || isSendingReset) return;
    if (!browserSupabaseAuth) {
      notifyError('Password reset is not configured.');
      return;
    }
    setIsSendingReset(true);
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await browserSupabaseAuth.auth.resetPasswordForEmail(user.email, { redirectTo });
      if (error) throw error;
      setIsAccountMenuOpen(false);
      notifySuccess(`Password reset link sent to ${user.email}.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to send password reset email.');
    } finally {
      setIsSendingReset(false);
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Registration Dashboard', navLabel: 'Overview', icon: LayoutDashboard },
    { id: 'submissions', label: 'Registration Queue', icon: Inbox },
    { id: 'user-registration', label: 'User Access Reg.', icon: UserRoundPlus },
  ];

  const registrationQueueItems = [
    { id: 'submissions-pending', label: 'Pending', status: 'PENDING' as const, icon: Clock3 },
    { id: 'submissions-done', label: 'Closed / Done', status: 'DONE' as const, icon: CircleCheck },
    { id: 'submissions-rejected', label: 'Rejected', status: 'REJECTED' as const, icon: CircleX },
  ];

  const activeQueueItem = registrationQueueItems.find((item) => item.id === activeTab);

  const devToolItems = [
    { id: 'companies', label: 'Company list', icon: Building2, section: 'Registration Setup', path: undefined },
    { id: 'email-template', label: 'Registration Templates', icon: Mail, section: 'Registration Setup', path: undefined },
    { id: 'guidelines', label: 'Haulier Guidelines', icon: BookOpen, section: 'Registration Setup', path: undefined },
    { id: 'admin-user', label: 'Admin Users', icon: UserRoundPlus, section: 'Dev Admin', path: undefined },
    { id: 'developer-settings', label: 'Dev Setting', icon: Wrench, section: 'Dev Admin', path: undefined },
    { id: 'system-version', label: 'System Information', icon: Info, section: 'Dev Admin', path: undefined },
  ];

  const switchPortal = () => {
    const nextPortal = portalMode === 'admin' ? 'developer' : 'admin';
    setPortalMode(nextPortal);
    setActiveTab(nextPortal === 'developer' ? 'companies' : 'dashboard');
    setIsRegistrationQueueExpanded(false);
    setIsMobileSidebarOpen(false);
    setIsAccountMenuOpen(false);
  };

  const goToPortalHome = () => {
    setActiveTab(portalMode === 'admin' ? 'dashboard' : 'companies');
    setEmailTemplateView('list');
    setIsRegistrationQueueExpanded(false);
    setIsMobileSidebarOpen(false);
    setIsAccountMenuOpen(false);
  };

  const isDevSettingsPage = activeTab === 'schema' || activeTab === 'scheduler' || activeTab === 'ports' || activeTab === 'auto-email-config' || activeTab === 'auto-register-cm';
  const activePageLabel = activeTab === 'auto-email-config' ? 'Auto Email Config' : activeTab === 'auto-register-cm' ? 'Auto Register in CM' : activeTab === 'auto-mail' ? 'Tools / Auto Mail' : activeTab === 'system-version' ? 'System Version' : activeTab === 'ports' ? 'Ports & Depots' : activeTab === 'schema' ? 'Excel Mapping' : activeTab === 'scheduler' ? 'Scheduler' : activeTab === 'northport-recovery' ? 'Tools / NP Container' : [...navItems, ...registrationQueueItems, ...devToolItems]
    .find((item) => item.id === activeTab)?.label ?? (activeTab === 'account-settings' ? 'Account & Setting' : 'Dashboard');

  return (
    <div hidden={!active} data-sidebar-collapsed={isSidebarCollapsed ? 'true' : 'false'} style={active ? undefined : { display: 'none' }} className="admin-theme min-h-screen bg-[#f6f8fb] flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col shrink-0 overflow-visible border-r border-[#17263d] bg-[#0b1930] text-slate-300 shadow-2xl transition-[width,transform] duration-300 ease-out md:relative md:inset-auto md:h-screen md:w-64 md:translate-x-0 md:shadow-none md:sticky md:top-0 md:self-start ${
          isMobileSidebarOpen ? 'translate-x-0' : ''
        } ${
          isSidebarCollapsed ? 'md:w-[60px]' : 'md:w-[185px]'
        }`}
      >
        <div ref={accountMenuRef} className={`relative flex h-12 shrink-0 items-center border-b border-white/10 px-2 ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''}`}>
          <div className={`flex min-w-0 flex-1 items-center gap-2 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
            <ProfileAvatar url={avatarUrl} name={user?.full_name || user?.username || user?.email || 'Admin'} className="h-8 w-8 text-xs" />
            <div className="min-w-0 flex-1 select-none">
              <p className="truncate text-sm font-medium leading-4 text-white md:text-xs">CargoMove</p>
              <p className="truncate text-[11px] leading-3.5 text-sky-200 md:text-[10px]">{portalMode === 'admin' ? 'Admin portal' : 'Developer tools'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isSidebarCollapsed) setIsSidebarCollapsed(false);
              setIsAccountMenuOpen((open) => !open);
            }}
            aria-label="Account menu"
            aria-expanded={isAccountMenuOpen}
            aria-controls="admin-account-menu"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0095e8] ${isSidebarCollapsed ? 'md:mx-auto' : ''}`}
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          {isAccountMenuOpen && (
            <div id="admin-account-menu" className="absolute right-2 top-full z-50 mt-2 w-[min(15rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-white/10 bg-[#111d35] p-2 text-slate-200 shadow-[0_18px_35px_rgba(2,6,23,0.3)] md:left-[calc(100%+0.5rem)] md:right-auto md:top-2 md:mt-0">
              <div className="border-b border-white/10 px-2 pb-2 pt-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">Account</p>
                <div className="mt-2 flex min-w-0 items-center gap-2"><ProfileAvatar url={avatarUrl} name={user?.full_name || user?.email || 'Admin'} className="h-8 w-8 text-xs" /><div className="min-w-0"><p className="flex items-center gap-1 truncate text-xs font-semibold text-slate-100">@{user?.username || 'username'}{['support', 'stanlly'].includes((user?.username || '').toLowerCase()) && <BadgeCheck aria-label="Verified" className="h-4 w-4 shrink-0 fill-blue-500 text-white" />}</p><p className="truncate text-[11px] text-slate-300">{user?.full_name || 'Signed-in admin'}</p></div></div>
              </div>
              <div className="space-y-0.5 pt-1.5">
                <button type="button" onClick={() => { setActiveTab('account-settings'); setIsAccountMenuOpen(false); setIsMobileSidebarOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-normal hover:bg-white/10">
                  <Settings className="h-4 w-4 shrink-0" />Account &amp; Setting
                </button>
                <button type="button" onClick={() => { setIsAccountMenuOpen(false); onLogout(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-normal text-rose-300 hover:bg-rose-400/10">
                  <LogOut className="h-4 w-4 shrink-0" />Logout
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation list */}
        <nav
          aria-label={portalMode === 'admin' ? 'Admin navigation' : 'Developer navigation'}
          className={`min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 py-3 ${isSidebarCollapsed ? 'md:px-2' : ''}`}
        >
          {portalMode === 'admin' && <p className={`px-2 pb-1 text-[11px] md:text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Registration</p>}
          {portalMode === 'admin' && navItems.map((item) => {
            const Icon = item.icon;
            const isRegistrationQueue = item.id === 'submissions';
            const isActive = isRegistrationQueue ? Boolean(activeQueueItem) : activeTab === item.id;
            const notificationCount = isRegistrationQueue
              ? pendingSubmissionCount
              : item.id === 'user-registration' ? pendingUserCount : 0;

            return (
              <React.Fragment key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (isRegistrationQueue) {
                      if (isSidebarCollapsed) {
                        setIsSidebarCollapsed(false);
                        setIsRegistrationQueueExpanded(true);
                      } else {
                        setIsRegistrationQueueExpanded((expanded) => !expanded);
                      }
                      if (window.innerWidth < 768) setIsMobileSidebarOpen(true);
                    } else {
                      setActiveTab(item.id);
                      setIsRegistrationQueueExpanded(false);
                      setIsMobileSidebarOpen(false);
                    }
                  }}
                  aria-expanded={isRegistrationQueue ? isRegistrationQueueExpanded : undefined}
                  aria-label={isSidebarCollapsed ? item.label : undefined}
                  title={isSidebarCollapsed ? item.label : undefined}
                  className={`relative w-full flex items-center rounded-lg py-2 text-[11px] font-medium transition-all ${isRegistrationQueue ? 'gap-1 px-1.5' : 'gap-2 px-2'} ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${
                    isActive
                      ? 'bg-[#0095e8] text-white shadow-sm font-semibold'
                      : 'text-slate-300 hover:text-white hover:bg-white/8'
                  }`}
                >
                  <Icon className={`shrink-0 ${isRegistrationQueue ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
                  <span className={`min-w-0 flex-1 text-left ${isRegistrationQueue ? 'whitespace-nowrap tracking-tight' : 'truncate'} ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{item.navLabel || item.label}</span>
                  {notificationCount > 0 && (
                    <span
                      aria-label={`${notificationCount} pending`}
                      className="absolute right-0 top-0 inline-flex h-5 min-w-5 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm"
                    >
                      {notificationCount > 99 ? '99+' : notificationCount}
                    </span>
                  )}
                  {isRegistrationQueue && (
                    <ChevronDown className={`h-3 w-3 shrink-0 transition-transform duration-200 ease-out ${isSidebarCollapsed ? 'md:hidden' : ''} ${isRegistrationQueueExpanded ? 'rotate-180' : ''}`} />
                  )}
                </button>

                {isRegistrationQueue && (
                  <div
                    aria-hidden={!isRegistrationQueueExpanded}
                    className={`overflow-hidden transition-[max-height,opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
                      isRegistrationQueueExpanded
                        ? 'max-h-[136px] translate-y-0 opacity-100'
                        : 'pointer-events-none max-h-0 -translate-y-1 opacity-0'
                    } ${isSidebarCollapsed ? 'md:hidden' : ''}`}
                  >
                    <div className="ml-3 mt-1 space-y-0.5 border-l border-slate-700 pl-2">
                      {registrationQueueItems.map((queueItem) => {
                        const QueueIcon = queueItem.icon;
                        const isQueueItemActive = activeTab === queueItem.id;
                        return (
                          <button
                            key={queueItem.id}
                            type="button"
                            tabIndex={isRegistrationQueueExpanded ? 0 : -1}
                            onClick={() => {
                              setActiveTab(queueItem.id);
                              setIsMobileSidebarOpen(false);
                            }}
                            className={`relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                              isQueueItemActive
                                ? 'bg-slate-800 font-semibold text-white'
                                : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100'
                            }`}
                          >
                            <QueueIcon className="h-3.5 w-3.5 shrink-0" />
                            <span className="flex-1 text-left">{queueItem.label}</span>
                            {queueItem.status === 'PENDING' && pendingSubmissionCount > 0 && (
                              <span
                                aria-label={`${pendingSubmissionCount} pending`}
                                className="absolute right-2 top-1/2 inline-flex h-2 w-2 -translate-y-1/2 items-center justify-center rounded-full bg-orange-500 shadow-sm"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {portalMode === 'admin' && user?.type === 'ADMIN' && (
            <>
              <p className={`mt-4 border-t border-white/10 px-2 pb-1 pt-3 text-[11px] md:text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Tools</p>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('northport-recovery');
                  setIsMobileSidebarOpen(false);
                }}
                aria-label="NP Container"
                aria-current={activeTab === 'northport-recovery' ? 'page' : undefined}
                title="NP Container"
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[11px] font-medium transition-all ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${activeTab === 'northport-recovery' ? 'bg-[#0095e8] font-semibold text-white shadow-sm' : 'text-slate-300 hover:bg-white/8 hover:text-white'}`}
              >
                <Container className="h-4 w-4 shrink-0" />
                <span className={`min-w-0 flex-1 truncate text-left ${isSidebarCollapsed ? 'md:hidden' : ''}`}>NP Container</span>
              </button>
              <button type="button" onClick={() => { setActiveTab('auto-mail'); setIsMobileSidebarOpen(false); }} aria-label="Auto Mail" aria-current={activeTab === 'auto-mail' ? 'page' : undefined} title="Auto Mail" className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[11px] font-medium transition-all ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${activeTab === 'auto-mail' ? 'bg-[#0095e8] font-semibold text-white shadow-sm' : 'text-slate-300 hover:bg-white/8 hover:text-white'}`}>
                <Mail className="h-4 w-4 shrink-0" /><span className={`min-w-0 flex-1 truncate text-left ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Auto Mail</span>
              </button>
            </>
          )}

          {portalMode === 'developer' && devToolItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id || (item.id === 'developer-settings' && isDevSettingsPage);

            return (
              <React.Fragment key={item.id}>
                {(index === 0 || devToolItems[index - 1].section !== item.section) && (
                  <p className={`px-2 pb-1 text-[11px] md:text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500 ${index > 0 ? 'mt-4 border-t border-white/10 pt-3' : ''} ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{item.section}</p>
                )}
              <button
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id === 'email-template') setEmailTemplateView('list');
                  setIsMobileSidebarOpen(false);
                }}
                aria-label={isSidebarCollapsed ? item.label : undefined}
                title={item.label}
                className={`w-full flex items-center rounded-lg py-2 text-[11px] font-medium transition-all ${item.id === 'email-template' ? 'gap-1.5 px-1.5' : 'gap-2 px-2'} ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${
                  isActive
                    ? 'bg-[#0095e8] text-white shadow-sm font-semibold'
                    : 'text-slate-300 hover:text-white hover:bg-white/8'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className={`min-w-0 flex-1 text-left ${item.id === 'email-template' ? 'whitespace-nowrap tracking-tight' : 'truncate'} ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{item.label}</span>
              </button>
              </React.Fragment>
            );
          })}
        </nav>

        {/* Sidebar collapse control */}
        <div className={`hidden shrink-0 justify-end px-3 py-2 md:flex ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''}`}>
          <button
            type="button"
            onClick={() => { setIsSidebarCollapsed((collapsed) => !collapsed); setIsAccountMenuOpen(false); }}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-slate-400 shadow-sm transition-all hover:border-slate-400 hover:bg-slate-800 hover:text-white hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            {isSidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Sidebar Footer */}
        <div className={`shrink-0 border-t border-slate-800 space-y-2 p-3 ${isSidebarCollapsed ? 'md:p-2' : ''}`}>
          <button
            type="button"
            onClick={switchPortal}
            aria-label={portalMode === 'admin' ? 'Open Developer' : 'Return to Admin Portal'}
            title={isSidebarCollapsed ? (portalMode === 'admin' ? 'Developer' : 'Admin Portal') : undefined}
            className={`flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-normal text-slate-200 transition-colors hover:bg-slate-700 ${isSidebarCollapsed ? 'md:px-2' : ''}`}
          >
            {portalMode === 'admin' ? (
              <Wrench className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className={isSidebarCollapsed ? 'md:hidden' : ''}>
              {portalMode === 'admin' ? 'Developer' : 'Admin Portal'}
            </span>
          </button>
        </div>
      </aside>

      <button
        type="button"
        aria-label="Close navigation menu"
        onClick={() => setIsMobileSidebarOpen(false)}
        className={`fixed inset-0 z-40 bg-slate-950/50 transition-opacity duration-300 md:hidden ${isMobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />

      {/* Main Administrative Pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen((open) => !open)}
              aria-label={isMobileSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={isMobileSidebarOpen}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 md:hidden"
            >
              {isMobileSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={goToPortalHome}
              aria-label={`Go to ${portalMode === 'admin' ? 'Admin Portal' : 'Developer'} home`}
              title="Home"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-sky-50 hover:text-[#0095e8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0095e8]"
            >
              <Home className="h-[17px] w-[17px]" />
            </button>
            <BreadcrumbChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
            <h1 ref={breadcrumbRef} className="flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap text-sm font-semibold text-slate-700">
              {isDevSettingsPage && <><button type="button" onClick={() => setActiveTab('developer-settings')} className="shrink-0 hover:text-[#0095e8]">Dev Setting</button><BreadcrumbChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" /></>}
              <span className="shrink-0">{activePageLabel}</span>
              {activeTab==='auto-mail'&&mailBreadcrumbs.map((label,index)=><React.Fragment key={index}><BreadcrumbChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true"/><span aria-current={index===mailBreadcrumbs.length-1?'page':undefined} className="shrink-0">{label}</span></React.Fragment>)}
              {activeTab === 'email-template' && emailTemplateView === 'design' && <><BreadcrumbChevronRight className="h-4 w-4 shrink-0 text-slate-300" /><span className="truncate">Design Template</span></>}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              aria-label={isRefreshing ? 'Checking for new data' : 'Refresh data'}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isRefreshing ? 'Checking...' : 'Refresh data'}</span>
            </button>

          </div>
        </header>

        {/* Content Body */}
        <main
          className={`flex-1 w-full p-4 sm:p-6 lg:px-7 lg:py-4 transition-[max-width] duration-200 ${
            activeTab === 'auto-mail' ? 'max-w-none !p-0' : (activeQueueItem || activeTab === 'user-registration') && isSidebarCollapsed ? 'max-w-none' : 'mx-auto max-w-[1600px]'
          }`}
        >
          <div key={`${portalMode}:${activeQueueItem ? 'registration-queue' : activeTab}`} className="w-full min-w-0">
          {activeTab === 'dashboard' && (
            <AdminDashboard onNavigate={(tab, registrationType) => {
              const destination = tab === 'submissions' ? 'submissions-pending' : tab;
              if (registrationType) setQueueRegistrationType(registrationType);
              if (devToolItems.some((item) => item.id === destination) || ['ports', 'schema', 'scheduler'].includes(destination)) {
                setPortalMode('developer');
              }
              setActiveTab(destination);
              if (destination.startsWith('submissions-')) {
                setIsRegistrationQueueExpanded(true);
              } else {
                setIsRegistrationQueueExpanded(false);
              }
            }} />
          )}
          {activeTab === 'companies' && <CompanyMaster />}
          {activeTab === 'auto-mail' && user?.type === 'ADMIN' && <AutoMail onBreadcrumbChange={setMailBreadcrumbs} key={user.id} cacheScope={user.id} pollEnabled={active} onOpenConfig={openAutoEmailConfig} />}
          {activeQueueItem && (
            <SubmissionsList
              status={activeQueueItem.status}
              initialType={queueRegistrationType}
              refreshVersion={dataRefreshVersion}
            />
          )}
          {activeTab === 'user-registration' && <UserRegistration />}
          {activeTab === 'admin-user' && <AdminUser />}
          {activeTab === 'email-template' && <EmailTemplateManager onViewChange={setEmailTemplateView} />}
          {activeTab === 'guidelines' && (
            <GuidelineManager />
          )}
          {activeTab === 'ports' && <PortDepotConfig />}
          {activeTab === 'schema' && <SchemaMappingInspector />}
          {activeTab === 'developer-settings' && <DeveloperSettings autoRegisterCacheScope={user?.id || user?.email}
            onOpenAutoRegisterCm={() => setActiveTab('auto-register-cm')} onOpenScheduler={() => setActiveTab('scheduler')} onOpenExcelMapping={() => setActiveTab('schema')} onOpenPortDepotConfig={() => setActiveTab('ports')} onOpenAutoEmailConfig={() => openAutoEmailConfig()} />}
          {activeTab === 'auto-email-config' && user?.type === 'ADMIN' && <AutoEmailConfig onBack={() => setActiveTab('developer-settings')} onOpenMail={() => { setPortalMode('admin'); setActiveTab('auto-mail'); }} />}
          {activeTab === 'system-version' && <SystemVersion />}
          {activeTab === 'scheduler' && <div className="w-full space-y-4"><div><h2 className="text-xl font-bold tracking-tight text-slate-900">Scheduler</h2><p className="mt-1 text-xs text-slate-500">Manage saved schedulers and request a run when needed.</p></div><CargoMoveScheduler /></div>}
          {activeTab === 'auto-register-cm' && user?.type === 'ADMIN' && <AutoRegisterCmPage
            onBack={() => setActiveTab('developer-settings')}
            cacheScope={user.id || user.email}
            refreshVersion={dataRefreshVersion}
          />}
          {(hasOpenedNorthport || activeTab === 'northport-recovery') && user?.type === 'ADMIN' && <NorthportRecovery key={user.email} active={active && activeTab === 'northport-recovery' && portalMode === 'admin'} onBack={goToPortalHome} />}
          {activeTab === 'account-settings' && <AccountSettings user={user} avatarUrl={avatarUrl} onAvatarChange={setAvatarUrl} onUserChange={onUserChange} onReset={() => void handlePasswordReset()} sendingReset={isSendingReset} />}
          </div>
        </main>
      </div>

      <NotificationToaster
        position="top-center"
        gutter={10}
        containerStyle={{ top: 16 }}
        toastOptions={{ duration: 4000 }}
      />
    </div>
  );
}
