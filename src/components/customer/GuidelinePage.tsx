import { PortalPageProps, portalHeaderNavigation, usePortalTheme } from './portalNavigation';
import React from 'react';
import { Clock3 } from 'lucide-react';
import guidelineBackground from '../../../media/guideline-background-fast.webp';
import { PortalFooterBottom } from './PortalFooterBottom';
import { PortalHeader } from './PortalHeader';
import './HomePage.css';
import './GuidelinePage.css';

export function GuidelinePage({ onNavigate }: PortalPageProps) {
  const { theme, toggleTheme } = usePortalTheme();

  return (
    <div className="cm-home cm-guideline" data-theme={theme}>
      <a className="cm-home-skip" href="#guideline-main">Skip to content</a>
      <div className="cm-guideline-screen">
      <PortalHeader
        theme={theme}
        onToggleTheme={toggleTheme}
        {...portalHeaderNavigation(onNavigate)}
        currentPage="guideline"
      />
      <main id="guideline-main">
        <section className="cm-guideline-hero" aria-labelledby="guideline-heading">
          <div className="cm-guideline-background" style={{ backgroundImage: `url(${guidelineBackground})` }} aria-hidden="true" />
          <div className="cm-guideline-overlay" aria-hidden="true" />
          <div className="cm-guideline-shell">
            <div className="cm-guideline-content">
              <span className="cm-home-section-label">GUIDELINE</span>
              <h1 id="guideline-heading">Coming <span>soon.</span></h1>
              <p>We’re bringing CargoMove guidelines together in one place.<br />Helpful instructions and resources are being prepared. Check back soon.</p>
              <span className="cm-guideline-status"><Clock3 size={16} aria-hidden="true" /> In preparation</span>
            </div>
          </div>
        </section>
      </main>
      </div>
      <footer className="cm-guideline-footer"><PortalFooterBottom /></footer>
    </div>
  );
}

