import React, { useState, useEffect } from 'react';
import { RegistrationWizard } from './components/customer/RegistrationWizard';
import { AdminLayout } from './components/admin/AdminLayout';
import { LoginPage } from './components/auth/LoginPage';
import { PasswordResetPage } from './components/auth/PasswordResetPage';
import { clearProtectedStorage, refreshProtectedStorage, startProtectedStorageSync } from './services/storage';
import { getApplicationSession, logoutApplicationUser } from './services/auth';

export default function App() {
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => window.location.hash.includes('type=recovery') || window.location.hash.includes('error_code=otp_expired'));
  const [viewMode, setViewMode] = useState<'CUSTOMER' | 'LOGIN' | 'ADMIN'>(()=>window.location.pathname.startsWith('/admin/support') ? 'LOGIN' : 'CUSTOMER');
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void getApplicationSession().then(({ authenticated }) => {
      if (!isMounted) return;
      setIsAuthenticated(authenticated);
      if (authenticated) setViewMode('ADMIN');
      setIsAuthLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const stopSync = startProtectedStorageSync();
    return stopSync;
  }, [isAuthenticated]);

  if (isAuthLoading) {
    return <div className="min-h-screen bg-[#f8fafc]" aria-busy="true" />;
  }

  if (isPasswordRecovery) {
    return <PasswordResetPage onDone={() => { setIsPasswordRecovery(false); setViewMode('LOGIN'); }} />;
  }

  return (
    <div className="min-h-screen text-slate-800 antialiased font-sans">
      {viewMode === 'CUSTOMER' ? (
        <RegistrationWizard onSwitchToAdmin={() => setViewMode('LOGIN')} />
      ) : viewMode === 'LOGIN' ? (
        <LoginPage
          onBack={() => setViewMode('CUSTOMER')}
          onSuccess={(authenticated) => {
            setIsAuthenticated(authenticated);
            setViewMode('ADMIN');
          }}
        />
      ) : (
        <AdminLayout
          onSwitchToCustomer={() => setViewMode('CUSTOMER')}
          onRefreshData={() => refreshProtectedStorage()}
          onLogout={async () => {
            await logoutApplicationUser();
            clearProtectedStorage();
            setIsAuthenticated(false);
            setViewMode('CUSTOMER');
          }}
        />
      )}
    </div>
  );
}
