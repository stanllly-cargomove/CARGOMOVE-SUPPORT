import React from 'react';
import { ArrowRight, Moon, Sun } from 'lucide-react';
import cargoMoveLogo from '../../../media/image-removebg-preview.webp';

interface PortalHeaderProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onRegister: () => void;
  onTrackStatus: () => void;
  onGuideline: () => void;
  onLogin: () => void;
  currentPage?: 'register' | 'track' | 'guideline' | 'login';
  homeHref?: string;
  onHome?: () => void;
}

export function PortalHeader({ theme, onToggleTheme, onRegister, onTrackStatus, onGuideline, onLogin, currentPage, homeHref, onHome }: PortalHeaderProps) {
  const logo = <img className="cm-home-logo" src={cargoMoveLogo} alt="CargoMove" width="180" height="58" />;

  return (
    <header className="cm-home-header">
      {homeHref ? <a href={homeHref} onClick={onHome ? event => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onHome(); } } : undefined} aria-label="CargoMove home">{logo}</a> : logo}
      <nav className="cm-home-nav" aria-label="Main navigation">
        <button type="button" onClick={onRegister} aria-current={currentPage === 'register' ? 'page' : undefined}>REGISTER</button>
        <button type="button" onClick={onTrackStatus} aria-current={currentPage === 'track' ? 'page' : undefined}>TRACK STATUS</button>
        <button type="button" onClick={onGuideline} aria-current={currentPage === 'guideline' ? 'page' : undefined}>GUIDELINE</button>
      </nav>
      <div className="cm-home-header-actions">
        <button className="cm-home-theme-toggle" type="button" role="switch" aria-checked={theme === 'dark'} onClick={onToggleTheme} aria-label="Dark theme" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <span className="cm-home-theme-track" aria-hidden="true">
            <Sun className="cm-home-theme-sun" size={13} />
            <Moon className="cm-home-theme-moon" size={13} />
            <span className="cm-home-theme-thumb">{theme === 'dark' ? <Moon size={12} /> : <Sun size={13} />}</span>
          </span>
        </button>
        <button className="cm-home-login" type="button" onClick={onLogin} aria-current={currentPage === 'login' ? 'page' : undefined}>Login <ArrowRight size={15} aria-hidden="true" /></button>
      </div>
    </header>
  );
}
