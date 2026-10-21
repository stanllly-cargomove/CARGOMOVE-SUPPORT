import React, { useState, useEffect, useCallback } from 'react';
import { HomePage } from './components/customer/HomePage';
import { AdminLayout } from './components/admin/AdminLayout';
import { RegistrationPage } from './components/customer/RegistrationPage';
import { TrackStatusPage } from './components/customer/TrackStatusPage';
import { GuidelinePage } from './components/customer/GuidelinePage';
import { PortalLoginPage } from './components/customer/PortalLoginPage';
import { PasswordResetPage } from './components/auth/PasswordResetPage';
import { PortalPage, pageFromPath, portalPaths } from './components/customer/portalNavigation';
import { clearProtectedStorage, refreshProtectedStorage, startProtectedStorageSync } from './services/storage';
import { ApplicationUser, getApplicationSession, logoutApplicationUser } from './services/auth';

export default function App() {
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => window.location.hash.includes('type=recovery') || window.location.hash.includes('error_code=otp_expired'));
  const [page, setPage] = useState(() => pageFromPath(window.location.pathname));
  const [routeKey, setRouteKey] = useState(() => window.location.pathname + window.location.search);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<ApplicationUser | null>(null);
  const [hasOpenedAdmin, setHasOpenedAdmin] = useState(false);
  useEffect(() => { if (page === 'admin' && currentUser) setHasOpenedAdmin(true); }, [page, currentUser]);

  const navigate = useCallback((next: PortalPage, reference?: string) => {
    const url = portalPaths[next] + (reference ? `?reference_no=${encodeURIComponent(reference)}` : '');
    if (window.location.pathname + window.location.search !== url) window.history.pushState(null, '', url);
    setPage(next);
    setRouteKey(window.location.pathname + window.location.search);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onHashChange = () => setIsPasswordRecovery(window.location.hash.includes('type=recovery') || window.location.hash.includes('error_code=otp_expired'));
    const onPopState = () => {
      setPage(pageFromPath(window.location.pathname));
      setRouteKey(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void getApplicationSession().then(({ authenticated, user }) => {
      if (!mounted) return;
      setCurrentUser(authenticated ? user : null);
      if (authenticated && ['/', '/login', '/admin'].includes(window.location.pathname)) navigate('admin');
      setIsAuthLoading(false);
    });
    return () => { mounted = false; };
  }, [navigate]);

  useEffect(() => {
    if (currentUser) return startProtectedStorageSync();
  }, [currentUser]);

  useEffect(() => {
    if (!isAuthLoading && page === 'admin' && !currentUser) navigate('login');
  }, [isAuthLoading, page, currentUser, navigate]);

  if (isAuthLoading && page === 'admin' && !currentUser) return <div className="flex min-h-screen items-center justify-center bg-[#f6f8fb] text-sm text-slate-500" role="status">Loading your account…</div>;
  if (isPasswordRecovery) return <PasswordResetPage onDone={() => { setIsPasswordRecovery(false); navigate('login'); }} />;

  return (
    <div className="min-h-screen text-slate-800 antialiased font-sans">
      <React.Fragment key={routeKey}>
      {page === 'home' && <HomePage onRegister={() => navigate('register')} onTrackStatus={() => navigate('track')} onGuideline={() => navigate('guideline')} onLogin={() => navigate(currentUser ? 'admin' : 'login')} />}
      {page === 'register' && <RegistrationPage onNavigate={navigate} />}
      {page === 'track' && <TrackStatusPage onNavigate={navigate} />}
      {page === 'guideline' && <GuidelinePage onNavigate={navigate} />}
      {(page === 'login' || (page === 'admin' && !currentUser)) && <PortalLoginPage onNavigate={navigate} onSuccess={user => { setCurrentUser(user); navigate('admin'); }} />}
      </React.Fragment>
      {(page === 'admin' || hasOpenedAdmin) && currentUser && <AdminLayout
        key={currentUser.id}
        active={page === 'admin'}
        user={currentUser}
        onSwitchToCustomer={() => navigate('home')}
        onRefreshData={() => refreshProtectedStorage()}
        onUserChange={setCurrentUser}
        onLogout={async () => {
          await logoutApplicationUser();
          clearProtectedStorage();
          setCurrentUser(null);
          navigate('home');
        }}
      />}
    </div>
  );
}
