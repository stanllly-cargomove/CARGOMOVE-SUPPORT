import { PortalPageProps, portalHeaderNavigation, usePortalTheme } from './portalNavigation';
import React, { useEffect, useState } from 'react';
import { loadCustomerConfiguration } from '../../services/customerConfiguration';
import { MessageCircle } from 'lucide-react';
import { PortalHeader } from './PortalHeader';
import { PortalFooterBottom } from './PortalFooterBottom';
import { RegistrationWizard } from './RegistrationWizard';
import './HomePage.css';
import './RegistrationPage.css';

export function RegistrationPage({ onNavigate }: PortalPageProps) {
  const { theme, toggleTheme } = usePortalTheme();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [, setConfigurationRevision] = useState(0);
  useEffect(() => {
    let mounted = true;
    setError('');
    void loadCustomerConfiguration(true).then(() => {
      if (mounted) {
        setError('');
        setConfigurationRevision(revision => revision + 1);
      }
    })
      .catch(error => { if (mounted) setError(error instanceof Error ? error.message : 'Unable to load registration facilities.'); });
    return () => { mounted = false; };
  }, [attempt]);

  return (
    <div className="cm-home cm-register" data-theme={theme}>
      <a className="cm-home-skip" href="#register-main">Skip to registration</a>
      <PortalHeader
        theme={theme}
        onToggleTheme={toggleTheme}
        {...portalHeaderNavigation(onNavigate)}
        currentPage="register"
      />
      <main id="register-main">
        <section className="cm-register-panel" aria-label="Customer registration">
          {error && <div className="mx-auto mb-3 flex max-w-3xl flex-wrap items-center justify-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900" role="alert">
            <span>{error} The form is open using the last available facility list.</span>
            <button className="font-semibold underline underline-offset-2" type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
          </div>}
          <RegistrationWizard onTrackStatus={(reference) => onNavigate('track', reference)} />
          <div className="cm-register-help"><MessageCircle size={19} aria-hidden="true" /><span>Need help with your registration?</span><a href="https://wa.me/60182660085" target="_blank" rel="noreferrer">Contact support</a></div>
        </section>
      </main>
      <PortalFooterBottom />
    </div>
  );
}

