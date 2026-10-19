import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Headphones } from 'lucide-react';
import { PortalHeader } from '../src/components/customer/PortalHeader';
import { PortalFooterBottom } from '../src/components/customer/PortalFooterBottom';
import { RegistrationWizard } from '../src/components/customer/RegistrationWizard';
import '../src/index.css';
import '../src/components/customer/HomePage.css';
import './register.css';

function RegisterPreview() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return window.localStorage.getItem('cargomove-home-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { window.localStorage.setItem('cargomove-home-theme', next); }
    catch { /* Theme still changes when browser storage is unavailable. */ }
  };

  return (
    <div className="cm-home cm-register" data-theme={theme}>
      <a className="cm-home-skip" href="#register-main">Skip to registration</a>
      <PortalHeader
        theme={theme}
        onToggleTheme={toggleTheme}
        homeHref="./home.html"
        currentPage="register"
        onRegister={() => document.getElementById('register-main')?.scrollIntoView({ behavior: 'smooth' })}
        onTrackStatus={() => { window.location.href = './track-status.html'; }}
        onGuideline={() => { window.location.href = './guideline.html'; }}
        onLogin={() => { window.location.href = '../'; }}
      />
      <main id="register-main">
        <section className="cm-register-panel" aria-label="Customer registration">
          <RegistrationWizard onSwitchToAdmin={() => { window.location.href = '../'; }} />
          <div className="cm-register-help"><Headphones size={19} aria-hidden="true" /><span>Need help with your registration?</span><a href="mailto:support@cargomove.com.my">Contact support</a></div>
        </section>
      </main>
      <PortalFooterBottom />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><RegisterPreview /></React.StrictMode>);
