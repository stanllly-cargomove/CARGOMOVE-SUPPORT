import React, { useState } from 'react';
import { ArrowLeft, Clock3 } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import guidelineBackground from '../media/guideline-background.avif';
import { PortalFooterBottom } from '../src/components/customer/PortalFooterBottom';
import { PortalHeader } from '../src/components/customer/PortalHeader';
import '../src/index.css';
import '../src/components/customer/HomePage.css';
import './guideline.css';

function GuidelinePage() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return window.localStorage.getItem('cargomove-home-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const [previewMessage, setPreviewMessage] = useState('');
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { window.localStorage.setItem('cargomove-home-theme', next); }
    catch { /* The switch remains usable without storage. */ }
  };

  return (
    <div className="cm-home cm-guideline" data-theme={theme}>
      <a className="cm-home-skip" href="#guideline-main">Skip to content</a>
      <div className="cm-guideline-screen">
      <PortalHeader
        theme={theme}
        onToggleTheme={toggleTheme}
        homeHref="./home.html"
        currentPage="guideline"
        onRegister={() => setPreviewMessage('Register is not connected in this preview.')}
        onTrackStatus={() => { window.location.href = './track-status.html'; }}
        onGuideline={() => document.getElementById('guideline-main')?.scrollIntoView({ block: 'start' })}
        onLogin={() => setPreviewMessage('Login is not connected in this preview.')}
      />
      <main id="guideline-main">
        <section className="cm-guideline-hero" aria-labelledby="guideline-heading">
          <div className="cm-guideline-background" style={{ backgroundImage: `url(${guidelineBackground})` }} aria-hidden="true" />
          <div className="cm-guideline-overlay" aria-hidden="true" />
          <div className="cm-guideline-shell">
            <a className="cm-guideline-back" href="./home.html"><ArrowLeft size={16} aria-hidden="true" /> Back to home</a>
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
      <div className="cm-home-preview-message" role="status" aria-live="polite">{previewMessage && <><span>{previewMessage}</span><button type="button" onClick={() => setPreviewMessage('')} aria-label="Dismiss preview message">×</button></>}</div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><GuidelinePage /></React.StrictMode>);
