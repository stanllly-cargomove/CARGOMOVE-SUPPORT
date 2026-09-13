import React, { useState, useEffect } from 'react';
import { RegistrationWizard } from './components/customer/RegistrationWizard';
import { AdminLayout } from './components/admin/AdminLayout';
import { LoginPage } from './components/auth/LoginPage';
import { clearProtectedStorage, initStorage } from './services/storage';
import { supabase } from './services/supabase';

export default function App() {
  const [viewMode, setViewMode] = useState<'CUSTOMER' | 'LOGIN' | 'ADMIN'>('CUSTOMER');
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setIsAuthLoading(false);
      return;
    }

    let isMounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setIsAuthenticated(!!data.session);
      setIsAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      setIsAuthLoading(false);
      if (!session) setViewMode('CUSTOMER');
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) initStorage({ hydrateRemote: true });
  }, [isAuthenticated]);

  if (isAuthLoading) {
    return <div className="min-h-screen bg-[#f8fafc]" aria-busy="true" />;
  }

  return (
    <div className="min-h-screen text-slate-800 antialiased font-sans">
      {viewMode === 'CUSTOMER' ? (
        <RegistrationWizard onSwitchToAdmin={() => setViewMode('LOGIN')} />
      ) : viewMode === 'LOGIN' ? (
        <LoginPage onBack={() => setViewMode('CUSTOMER')} onSuccess={() => setViewMode('ADMIN')} />
      ) : (
        <AdminLayout
          onSwitchToCustomer={() => setViewMode('CUSTOMER')}
          onLogout={async () => {
            await supabase?.auth.signOut();
            clearProtectedStorage();
            setIsAuthenticated(false);
            setViewMode('CUSTOMER');
          }}
        />
      )}
    </div>
  );
}
