import React, { useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Bell, Building2, Caravan, ChevronRight, Headphones, Mail, MailOpen, MapPin, MessageCircle, Moon, MousePointer2, Phone, Sun, Truck, UserRound } from 'lucide-react';
import cargoMoveLogo from '../../../media/image-removebg-preview.png';
import portBackground from '../../../media/home-port-background.avif';
import './HomePage.css';

interface HomePageProps {
  onRegister?: () => void;
  onTrackStatus?: () => void;
  onGuideline?: () => void;
  onLogin?: () => void;
  onContactUs?: () => void;
}

function StepArtwork({ kind }: { kind: 'choose' | 'submit' | 'status' }) {
  return (
    <div className={`cm-home-step-art cm-home-step-art-${kind}`} aria-hidden="true">
      <span className="cm-home-art-halo" />
      {kind === 'status' ? <><MailOpen className="cm-home-art-envelope" /><span className="cm-home-art-letter"><i /><i /></span></> : <span className="cm-home-art-paper"><i /><i /><i /><i /></span>}
      {kind === 'choose' && <MousePointer2 className="cm-home-art-cursor" />}
      {kind === 'submit' && <span className="cm-home-art-badge"><ArrowUp /></span>}
      {kind === 'status' && <span className="cm-home-art-badge"><Bell /></span>}
    </div>
  );
}

function WhatsAppMark() {
  return <span className="cm-home-whatsapp-mark" aria-hidden="true"><MessageCircle /><Phone /></span>;
}

/** Standalone concept. Deliberately not imported by App or connected to navigation. */
export function HomePage({ onRegister, onTrackStatus, onGuideline, onLogin, onContactUs }: HomePageProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return window.localStorage.getItem('cargomove-home-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [previewMessage, setPreviewMessage] = useState('');
  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      window.localStorage.setItem('cargomove-home-theme', nextTheme);
    } catch {
      // The switch still works when browser storage is unavailable.
    }
  };
  const runAction = (label: string, action?: () => void) => {
    if (action) action();
    else setPreviewMessage(`${label} is not connected in this preview.`);
  };
  const scrollToBottom = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById('home-contact')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'end',
    });
  };

  return (
    <div className="cm-home" data-theme={theme}>
      <a className="cm-home-skip" href="#home-content">Skip to content</a>
      <header className="cm-home-header">
        <img className="cm-home-logo" src={cargoMoveLogo} alt="CargoMove" width="180" height="58" />
        <nav className="cm-home-nav" aria-label="Main navigation">
          <button type="button" onClick={() => runAction('Register', onRegister)}>REGISTER</button>
          <button type="button" onClick={() => runAction('Track status', onTrackStatus)}>TRACK STATUS</button>
          <button type="button" onClick={() => runAction('Guideline', onGuideline)}>GUIDELINE</button>
        </nav>
        <div className="cm-home-header-actions">
          <button className="cm-home-theme-toggle" type="button" role="switch" aria-checked={theme === 'dark'} onClick={toggleTheme} aria-label="Dark theme" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            <span className="cm-home-theme-track" aria-hidden="true">
              <Sun className="cm-home-theme-sun" size={13} />
              <Moon className="cm-home-theme-moon" size={13} />
              <span className="cm-home-theme-thumb">{theme === 'dark' ? <Moon size={12} /> : <Sun size={13} />}</span>
            </span>
          </button>
          <button className="cm-home-login" type="button" onClick={() => runAction('Login', onLogin)}>Login <ArrowRight size={15} aria-hidden="true" /></button>
        </div>
      </header>

      <main id="home-content">
        <section className="cm-home-hero" aria-labelledby="home-heading">
          <div className="cm-home-port" style={{ backgroundImage: `url(${portBackground})` }} aria-hidden="true" />
          <div className="cm-home-orbits" aria-hidden="true">
            <span className="cm-home-orbit cm-home-orbit-outer" />
            <span className="cm-home-orbit cm-home-orbit-inner" />
            <span className="cm-home-orbit-dot cm-home-orbit-dot-one" />
          </div>

          <div className="cm-home-hero-copy">
            <h1 id="home-heading">Your next move.<br /><span>Starts with registration.</span></h1>
            <p className="cm-home-intro">Take the first step towards your port operations. Register your company, drivers and fleet with CargoMove, all in one place.</p>
            <div className="cm-home-actions">
              <button className="cm-home-button cm-home-button-primary" type="button" onClick={() => runAction('Register', onRegister)}>Register <ArrowRight size={18} aria-hidden="true" /></button>
              {onContactUs ? <button className="cm-home-button cm-home-button-secondary" type="button" onClick={onContactUs}><Headphones size={18} aria-hidden="true" /> Contact us</button> : <a className="cm-home-button cm-home-button-secondary" href="#home-contact"><Headphones size={18} aria-hidden="true" /> Contact us</a>}
            </div>
            <p className="cm-home-help">Have a question before you begin? We’re here to help.</p>
            <div className="cm-home-locations"><MapPin size={14} aria-hidden="true" /><span>Port Klang</span><span className="cm-home-location-divider" /><span>Johor · Pasir Gudang</span></div>
          </div>

          <div className="cm-home-hero-caption" aria-hidden="true"><span className="cm-home-hero-caption-label"><span />CONNECTING YOUR BUSINESS TO THE PORT</span><span className="cm-home-hero-caption-version">V1.2.1</span></div>
          <a className="cm-home-explore" href="#home-contact" onClick={scrollToBottom} aria-label="Scroll to the bottom of the page"><ArrowDown size={17} aria-hidden="true" /></a>
        </section>

        <section className="cm-home-overview" id="registration-overview" aria-label="Registration overview">
          <div className="cm-home-category-strip">
            <p>One place to register.<br /><strong>Ready for your next move.</strong></p>
            <div><Building2 aria-hidden="true" /><span>Company</span></div>
            <div><UserRound aria-hidden="true" /><span>Driver</span></div>
            <div><Truck aria-hidden="true" /><span>Vehicle</span></div>
            <div><Caravan aria-hidden="true" /><span>Trailer</span></div>
          </div>
          <div className="cm-home-process-heading"><span className="cm-home-section-label">A CLEAR WAY FORWARD</span><h2>From your first step to <span>submission</span>.</h2><p>A guided registration process, with the information you need along the way.</p></div>
          <ol className="cm-home-steps" aria-label="Registration process">
            <li><span className="cm-home-step-number">01</span><div className="cm-home-step-copy"><h3>Choose your registration</h3><p>Select your port and the registration category that applies to you.</p></div><StepArtwork kind="choose" /><ChevronRight className="cm-home-step-connector" aria-hidden="true" /></li>
            <li><span className="cm-home-step-number">02</span><div className="cm-home-step-copy"><h3>Prepare and submit</h3><p>Follow the guideline, complete your details and upload the required documents.</p></div><StepArtwork kind="submit" /><ChevronRight className="cm-home-step-connector" aria-hidden="true" /></li>
            <li><span className="cm-home-step-number">03</span><div className="cm-home-step-copy"><h3>Stay informed</h3><p>Use Track status to check the progress of your registration after submission.</p></div><StepArtwork kind="status" /></li>
          </ol>
          <p className="cm-home-category-note">Registration categories and requirements depend on your selected port.</p>
        </section>
      </main>

      <footer className="cm-home-footer" id="home-contact" aria-labelledby="home-contact-heading">
        <div className="cm-home-contact-panel">
        <div className="cm-home-contact-header">
          <div><span className="cm-home-section-label">HERE TO HELP YOU MOVE FORWARD</span><h2 id="home-contact-heading">Let’s get you registered.</h2><p>Questions about your registration? Talk to the CargoMove support team.</p></div>
          <a className="cm-home-whatsapp" href="https://wa.me/60182660085" target="_blank" rel="noreferrer"><WhatsAppMark /><span>Chat on WhatsApp<small>For a faster response</small></span><ArrowRight size={17} aria-hidden="true" /></a>
        </div>
        <div className="cm-home-contact-details">
          <div className="cm-home-footer-brand"><img src={cargoMoveLogo} alt="CargoMove" width="156" height="50" /><p>Your first step towards<br />connected port operations.</p></div>
          <div className="cm-home-contact-item"><span className="cm-home-contact-icon"><Phone aria-hidden="true" /></span><div><span className="cm-home-contact-label">Call us</span><a href="tel:+60327712765">+60 3 2771 2765</a></div></div>
          <div className="cm-home-contact-item"><span className="cm-home-contact-icon"><Mail aria-hidden="true" /></span><div><span className="cm-home-contact-label">Email us</span><a href="mailto:support@cargomove.com.my">support@cargomove.com.my</a></div></div>
          <div className="cm-home-contact-item"><span className="cm-home-contact-icon"><WhatsAppMark /></span><div><span className="cm-home-contact-label">WhatsApp</span><a href="https://wa.me/60182660085" target="_blank" rel="noreferrer">+60 18 266 0085</a></div></div>
        </div>
        </div>
        <div className="cm-home-footer-bottom"><span>© {new Date().getFullYear()} CargoMove. All rights reserved.</span><span>Registration portal</span></div>
      </footer>
      <div className="cm-home-preview-message" role="status" aria-live="polite">{previewMessage && <><span>{previewMessage}</span><button type="button" onClick={() => setPreviewMessage('')} aria-label="Dismiss preview message">×</button></>}</div>
    </div>
  );
}
