import { AutomationSettings } from './support/AutomationSettings';
import { SupportAnalytics } from './support/SupportAnalytics';
import { LearningSuggestions } from './support/LearningSuggestions';
import { KnowledgeBase } from './support/KnowledgeBase';
import React, { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import {
  LayoutDashboard,
  ChartNoAxesCombined,
  Bot,
  Brain,
  Building2,
  Inbox,
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

import { SupportInbox } from './support/SupportInbox';
import { supportTab, supportCaseId } from '../../utils/support/routes';

const emailConfigurationTabs = new Set(['support-automation', 'support-learning', 'support-knowledge']);

function portalForPath(path: string): 'admin' | 'developer' {
  return emailConfigurationTabs.has(supportTab(path) || '') ? 'developer' : 'admin';
}

interface AdminLayoutProps {
  onSwitchToCustomer: () => void;
  onRefreshData: () => Promise<void>;
  onLogout: () => void;
}

export function AdminLayout({ onSwitchToCustomer, onRefreshData, onLogout }: AdminLayoutProps) {
  const [activeTab, setActiveTab] = useState<string>(()=>supportTab(window.location.pathname) || 'dashboard');
  const [supportPath,setSupportPath]=useState(window.location.pathname);
  const navigateSupport=(path:string)=>{
    window.history.pushState({},'',path);
    setSupportPath(path);setActiveTab(supportTab(path) || 'dashboard');setPortalMode(portalForPath(path));
    setIsRegistrationQueueExpanded(false);
  };
  useEffect(()=>{
    const back=()=>{setSupportPath(window.location.pathname);setActiveTab(supportTab(window.location.pathname) || 'dashboard');setPortalMode(portalForPath(window.location.pathname));};
    window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);
  },[]);
  useEffect(()=>{
    if(!activeTab.startsWith('support-') && supportTab(window.location.pathname)) window.history.pushState({},'','/');
  },[activeTab]);
  const [portalMode, setPortalMode] = useState<'admin' | 'developer'>(() => portalForPath(window.location.pathname));
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
    { id: 'dashboard', label: 'Registration Dashboard', icon: LayoutDashboard },
    { id: 'submissions', label: 'Registration Queue', icon: Inbox },
    { id: 'user-registration', label: 'User Access Registration', icon: UserRoundPlus },
  ];

  const supportItems = [
    { id: 'support-inbox', label: 'Email Inbox', icon: Mail, path: '/admin/support/inbox' },
    { id: 'support-analytics', label: 'Email Analytics', icon: ChartNoAxesCombined, path: '/admin/support/analytics' },
  ];

  const registrationQueueItems = [
    { id: 'submissions-pending', label: 'Pending', status: 'PENDING' as const, icon: Clock3 },
    { id: 'submissions-done', label: 'Closed / Done', status: 'DONE' as const, icon: CircleCheck },
    { id: 'submissions-rejected', label: 'Rejected', status: 'REJECTED' as const, icon: CircleX },
  ];

  const activeQueueItem = registrationQueueItems.find((item) => item.id === activeTab);

  const devToolItems = [
    { id: 'companies', label: 'Company Master', icon: Building2, section: 'Registration Setup', path: undefined },
    { id: 'guidelines', label: 'Haulier Guidelines', icon: BookOpen, section: 'Registration Setup', path: undefined },
    { id: 'ports', label: 'Ports & Depots', icon: Settings, section: 'Registration Setup', path: undefined },
    { id: 'schema', label: 'Excel Mapping', icon: TableProperties, section: 'Registration Setup', path: undefined },
    { id: 'email-template', label: 'Registration Templates', icon: Mail, section: 'Email Setup', path: undefined },
    { id: 'support-automation', label: 'Automation Rules', icon: Bot, section: 'Email Setup', path: '/admin/support/automation' },
    { id: 'support-knowledge', label: 'Knowledge Base', icon: BookOpen, section: 'Email Setup', path: '/admin/support/knowledge' },
    { id: 'support-learning', label: 'AI Learning', icon: Brain, section: 'Email Setup', path: '/admin/support/learning' },
    { id: 'admin-user', label: 'Admin Users', icon: UserRoundPlus, section: 'Administration', path: undefined },
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
          {portalMode === 'admin' && <p className={`px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Registration</p>}
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

          {portalMode === 'admin' && <div className="mt-5 space-y-1 border-t border-slate-800 pt-4">
            <p className={`px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Auto Email</p>
            {supportItems.map(item=>{const Icon=item.icon;return <button key={item.id} type="button" onClick={()=>navigateSupport(item.path)} title={item.label} aria-label={item.label} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${activeTab===item.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Icon className="h-4 w-4 shrink-0"/><span className={isSidebarCollapsed ? 'md:hidden' : ''}>{item.label}</span></button>;})}
          </div>}

          {portalMode === 'developer' && devToolItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <React.Fragment key={item.id}>
                {(index === 0 || devToolItems[index - 1].section !== item.section) && (
                  <p className={`px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 ${index > 0 ? 'mt-5 border-t border-slate-800 pt-4' : 'pt-2'} ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{item.section}</p>
                )}
              <button
                type="button"
                onClick={() => {
                  if (item.path) navigateSupport(item.path);
                  else setActiveTab(item.id);
                  if (item.id === 'email-template') setEmailTemplateView('list');
                }}
                aria-label={isSidebarCollapsed ? item.label : undefined}
                title={isSidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold transition-all ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs font-bold'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className={`flex-1 text-left ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{item.label}</span>
              </button>
              </React.Fragment>
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
            aria-label={portalMode === 'admin' ? 'Open Dev Tools' : 'Return to Admin Portal'}
            title={isSidebarCollapsed ? (portalMode === 'admin' ? 'Dev Tools' : 'Admin Portal') : undefined}
            className={`flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:bg-slate-700 ${isSidebarCollapsed ? 'md:px-2' : ''}`}
          >
            {portalMode === 'admin' ? (
              <Wrench className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className={isSidebarCollapsed ? 'md:hidden' : ''}>
              {portalMode === 'admin' ? 'Dev Tools' : 'Admin Portal'}
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
              {portalMode === 'admin' ? 'Admin Portal' : 'Dev Tools'}
            </span>
            <span className="text-slate-300">/</span>
            <h1 className="flex items-center gap-3 text-sm font-bold text-slate-900">
              <span>{[...navItems, ...registrationQueueItems, ...devToolItems, ...supportItems].find((item) => item.id === activeTab)?.label}</span>
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
        <main
          className={`flex-1 w-full p-4 sm:p-6 lg:p-8 transition-[max-width] duration-200 ${
            (activeQueueItem || activeTab === 'user-registration') && isSidebarCollapsed ? 'max-w-none' : 'mx-auto max-w-7xl'
          }`}
        >
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
          {activeTab === 'support-automation' && <AutomationSettings/>}
          {activeTab === 'support-analytics' && <SupportAnalytics/>}
          {activeTab === 'support-learning' && <LearningSuggestions/>}
          {activeTab === 'support-knowledge' && <KnowledgeBase/>}
          {activeTab === 'support-inbox' && <SupportInbox caseId={supportCaseId(supportPath)} onNavigate={navigateSupport}/> }
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
