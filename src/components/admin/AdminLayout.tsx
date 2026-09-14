import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import {
  LayoutDashboard,
  Building2,
  Inbox,
  FileSpreadsheet,
  Settings,
  TableProperties,
  BookOpen,
  Wrench,
  UserRoundPlus,
  ChevronDown,
  Moon,
  Sun,
  RefreshCw,
  Mail,
  Clock3,
  CircleCheck,
  CircleX,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { AdminDashboard } from './AdminDashboard';
import { CompanyMaster } from './CompanyMaster';
import { SubmissionsList } from './SubmissionsList';
import { ExcelExportCenter } from './ExcelExportCenter';
import { PortDepotConfig } from './PortDepotConfig';
import { SchemaMappingInspector } from './SchemaMappingInspector';
import { GuidelineManager } from './GuidelineManager';
import { UserRegistration } from './UserRegistration';
import { AdminUser } from './AdminUser';
import { EmailTemplateManager } from './EmailTemplateManager';
import { Logo } from '../common/Logo';
import { notifyError, notifySuccess } from '../common/notifications';
import { RegistrationType } from '../../types';
import collapsedSidebarLogo from '../../../media/LOGO2.png';

interface AdminLayoutProps {
  onSwitchToCustomer: () => void;
  onRefreshData: () => Promise<void>;
  onLogout: () => void;
}

export function AdminLayout({ onSwitchToCustomer, onRefreshData, onLogout }: AdminLayoutProps) {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [portalMode, setPortalMode] = useState<'admin' | 'developer'>('admin');
  const [isRegistrationQueueExpanded, setIsRegistrationQueueExpanded] = useState(false);
  const [queueRegistrationType, setQueueRegistrationType] = useState<RegistrationType>('COMPANY');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [emailTemplateView, setEmailTemplateView] = useState<'list' | 'design'>('list');

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefreshData();
      notifySuccess('Latest database data loaded.');
    } catch {
      notifyError('Unable to check for new data.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Operations Dashboard', icon: LayoutDashboard },
    { id: 'submissions', label: 'Registration Queue', icon: Inbox },
    { id: 'user-registration', label: 'User Access Registration', icon: UserRoundPlus },
  ];

  const registrationQueueItems = [
    { id: 'submissions-pending', label: 'Pending', status: 'PENDING' as const, icon: Clock3 },
    { id: 'submissions-done', label: 'Closed / Done', status: 'DONE' as const, icon: CircleCheck },
    { id: 'submissions-rejected', label: 'Rejected', status: 'REJECTED' as const, icon: CircleX },
  ];

  const activeQueueItem = registrationQueueItems.find((item) => item.id === activeTab);

  const devToolItems = [
    { id: 'companies', label: 'Company Master', icon: Building2 },
    { id: 'admin-user', label: 'Admin user', icon: UserRoundPlus },
    { id: 'email-template', label: 'Email Template', icon: Mail },
    { id: 'guidelines', label: 'Haulier Guidelines', icon: BookOpen },
    { id: 'export', label: 'Excel Export Center', icon: FileSpreadsheet },
    { id: 'ports', label: 'Port & Depot Config', icon: Settings },
    { id: 'schema', label: 'Excel Schema & Mapping', icon: TableProperties },
  ];

  const switchPortal = () => {
    const nextPortal = portalMode === 'admin' ? 'developer' : 'admin';
    setPortalMode(nextPortal);
    setActiveTab(nextPortal === 'developer' ? 'companies' : 'dashboard');
    setIsRegistrationQueueExpanded(false);
  };

  return (
    <div className={`admin-theme min-h-screen bg-slate-100 flex flex-col md:flex-row ${isDarkMode ? 'admin-theme-dark' : ''}`}>
      {/* Sidebar */}
      <aside
        className={`relative w-full bg-[#0b1220] text-slate-300 flex flex-col shrink-0 border-r border-slate-800 transition-[width] duration-200 md:sticky md:top-0 md:h-screen md:self-start ${
          isSidebarCollapsed ? 'md:w-16' : 'md:w-60'
        }`}
      >
        <div className={`h-16 border-b border-slate-800/80 flex shrink-0 items-center px-3.5 ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''}`}>
          <div className={isSidebarCollapsed ? 'md:hidden' : ''}>
            <div className="flex items-center gap-2 select-none">
              <Logo size="sm" />
              <span className="text-[9px] font-bold text-white uppercase px-1.5 py-0.2 bg-[#ea7a24] rounded">
                {portalMode === 'admin' ? 'Admin' : 'Developer'}
              </span>
            </div>
          </div>

          <img
            src={collapsedSidebarLogo}
            alt="CargoMove"
            className={`hidden h-10 w-10 object-contain ${isSidebarCollapsed ? 'md:block' : ''}`}
          />

        </div>

        {/* Navigation list */}
        <nav
          aria-label={portalMode === 'admin' ? 'Admin navigation' : 'Developer navigation'}
          className={`min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3 ${isSidebarCollapsed ? 'md:p-2' : ''}`}
        >
          {portalMode === 'admin' && navItems.map((item) => {
            const Icon = item.icon;
            const isRegistrationQueue = item.id === 'submissions';
            const isActive = isRegistrationQueue ? Boolean(activeQueueItem) : activeTab === item.id;

            return (
              <React.Fragment key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (isRegistrationQueue) {
                      setIsRegistrationQueueExpanded((expanded) => isSidebarCollapsed || !expanded);
                      if (isSidebarCollapsed) setIsSidebarCollapsed(false);
                      if (!activeQueueItem) setActiveTab('submissions-pending');
                    } else {
                      setActiveTab(item.id);
                      setIsRegistrationQueueExpanded(false);
                    }
                  }}
                  aria-expanded={isRegistrationQueue ? isRegistrationQueueExpanded : undefined}
                  aria-label={isSidebarCollapsed ? item.label : undefined}
                  title={isSidebarCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs font-bold'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className={`flex-1 text-left ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{item.label}</span>
                  {isRegistrationQueue && (
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isSidebarCollapsed ? 'md:hidden' : ''} ${isRegistrationQueueExpanded ? 'rotate-180' : ''}`} />
                  )}
                </button>

                {isRegistrationQueue && isRegistrationQueueExpanded && (
                  <div className={`ml-3 mt-1 space-y-1 border-l border-slate-700 pl-3 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
                    {registrationQueueItems.map((queueItem) => {
                      const QueueIcon = queueItem.icon;
                      const isQueueItemActive = activeTab === queueItem.id;
                      return (
                        <button
                          key={queueItem.id}
                          type="button"
                          onClick={() => {
                            setActiveTab(queueItem.id);
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                            isQueueItemActive
                              ? 'bg-slate-800 font-bold text-white'
                              : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100'
                          }`}
                        >
                          <QueueIcon className="h-3.5 w-3.5 shrink-0" />
                          <span>{queueItem.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {portalMode === 'developer' && devToolItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id === 'email-template') setEmailTemplateView('list');
                }}
                aria-label={isSidebarCollapsed ? item.label : undefined}
                title={isSidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs font-bold'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={`flex-1 text-left ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar collapse control */}
        <div className={`hidden shrink-0 justify-end px-3 py-2 md:flex ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''}`}>
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
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
            aria-label={portalMode === 'admin' ? 'Open Developer Site' : 'Return to Admin Portal'}
            title={isSidebarCollapsed ? (portalMode === 'admin' ? 'Developer Site' : 'Admin Portal') : undefined}
            className={`flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:bg-slate-700 ${isSidebarCollapsed ? 'md:px-2' : ''}`}
          >
            {portalMode === 'admin' ? (
              <Wrench className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className={isSidebarCollapsed ? 'md:hidden' : ''}>
              {portalMode === 'admin' ? 'Developer Site' : 'Admin Portal'}
            </span>
          </button>
        </div>
      </aside>

      {/* Main Administrative Pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="bg-white border-b border-slate-200 h-16 px-6 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {portalMode === 'admin' ? 'Admin Portal' : 'Developer Portal'}
            </span>
            <span className="text-slate-300">/</span>
            <h1 className="flex items-center gap-3 text-sm font-bold text-slate-900">
              <span>{[...navItems, ...registrationQueueItems, ...devToolItems].find((item) => item.id === activeTab)?.label}</span>
              {activeTab === 'email-template' && emailTemplateView === 'design' && <><span className="font-normal text-slate-300">/</span><span>Design Template</span></>}
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

            <button
              type="button"
              onClick={() => setIsDarkMode((darkMode) => !darkMode)}
              aria-pressed={isDarkMode}
              aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              title={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className={`relative inline-flex w-12 h-7 shrink-0 items-center rounded-full border p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                isDarkMode
                  ? 'border-slate-600 bg-slate-700 focus:ring-offset-slate-800'
                  : 'border-slate-300 bg-slate-200 focus:ring-offset-white'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
                  isDarkMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              >
                {isDarkMode ? (
                  <Moon className="w-3 h-3 text-slate-700" />
                ) : (
                  <Sun className="w-3 h-3 text-amber-500" />
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 px-2 text-[11px] font-medium text-rose-500 transition-colors hover:text-rose-700 focus:outline-none"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <AdminDashboard onNavigate={(tab, registrationType) => {
              const destination = tab === 'submissions' ? 'submissions-pending' : tab;
              if (registrationType) setQueueRegistrationType(registrationType);
              if (devToolItems.some((item) => item.id === destination)) {
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
          {activeQueueItem && (
            <SubmissionsList
              status={activeQueueItem.status}
              initialType={queueRegistrationType}
            />
          )}
          {activeTab === 'user-registration' && <UserRegistration />}
          {activeTab === 'admin-user' && <AdminUser />}
          {activeTab === 'email-template' && <EmailTemplateManager onViewChange={setEmailTemplateView} />}
          {activeTab === 'guidelines' && (
            <GuidelineManager onPreviewCustomerView={onSwitchToCustomer} />
          )}
          {activeTab === 'export' && <ExcelExportCenter />}
          {activeTab === 'ports' && <PortDepotConfig />}
          {activeTab === 'schema' && <SchemaMappingInspector />}
        </main>
      </div>

      <Toaster
        position="top-center"
        gutter={10}
        containerStyle={{ top: 16 }}
        toastOptions={{ duration: 4000 }}
      />
    </div>
  );
}
