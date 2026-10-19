import type { ApplicationUser } from '../../services/auth';
import { PortalPageProps, portalHeaderNavigation, usePortalTheme } from './portalNavigation';
import React from 'react';
import { LoginPage } from '../auth/LoginPage';
import { PortalHeader } from './PortalHeader';
import { PortalFooterBottom } from './PortalFooterBottom';
import './HomePage.css';
import './PortalLoginPage.css';

export function PortalLoginPage({ onNavigate, onSuccess }: PortalPageProps & { onSuccess: (user: ApplicationUser) => void }) {
  const { theme, toggleTheme } = usePortalTheme();

  return (
    <div className="cm-home cm-login" data-theme={theme}>
      <a className="cm-home-skip" href="#login-main">Skip to login</a>
      <PortalHeader
        theme={theme}
        onToggleTheme={toggleTheme}
        {...portalHeaderNavigation(onNavigate)}
        currentPage="login"
      />
      <LoginPage
        embedded
        onBack={() => onNavigate('register')}
        onSuccess={onSuccess}
      />
      <footer><PortalFooterBottom /></footer>
    </div>
  );
}

