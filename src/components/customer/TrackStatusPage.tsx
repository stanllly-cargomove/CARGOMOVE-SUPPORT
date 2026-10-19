import { PortalPageProps, portalHeaderNavigation, usePortalTheme } from './portalNavigation';
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Clock3, Mail, Search } from 'lucide-react';
import { RegistrationTracking, trackRegistration } from '../../services/registration';
import { PortalFooterBottom } from './PortalFooterBottom';
import { PortalHeader } from './PortalHeader';
import portBackground from '../../../media/home-port-background-fast.webp';
import './HomePage.css';
import './TrackStatusPage.css';

const registrationLabels = { COMPANY: 'Company', DRIVER: 'Driver', VEHICLE: 'Vehicle', TRAILER: 'Trailer' };
const portLabels = { PORT_KLANG: 'Port Klang', JOHOR: 'Johor', OTHER: 'Other port' };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

export function TrackStatusPage({ onNavigate }: PortalPageProps) {
  const { theme, toggleTheme } = usePortalTheme();
  const [reference, setReference] = useState(() => new URLSearchParams(window.location.search).get('reference_no') ?? '');
  const [searchedReference, setSearchedReference] = useState('');
  const [tracking, setTracking] = useState<RegistrationTracking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tracking) return;
    const frame = window.requestAnimationFrame(() => {
      resultRef.current?.focus({ preventScroll: true });
      resultRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tracking]);

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = reference.trim().toUpperCase();
    if (!query || loading) return;
    setReference(query);
    setSearchedReference(query);
    setTracking(null);
    setError('');
    setLoading(true);
    try {
      setTracking(await trackRegistration(query));
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'Unable to check the registration status.');
    } finally {
      setLoading(false);
    }
  };

  const reviewDone = tracking?.submission_status === 'DONE';
  const reviewRejected = tracking?.submission_status === 'REJECTED';
  const isCompany = tracking?.registration_type === 'COMPANY';

  return (
    <div className="cm-home cm-track" data-theme={theme}>
      <a className="cm-home-skip" href="#track-main">Skip to content</a>
      <PortalHeader theme={theme} onToggleTheme={toggleTheme} {...portalHeaderNavigation(onNavigate)} currentPage="track" />

      <main id="track-main">
        <section className="cm-track-hero" aria-labelledby="track-heading">
          <div className="cm-track-port" style={{ backgroundImage: `url(${portBackground})` }} aria-hidden="true" />
          <div className="cm-track-hero-inner">
            <h1 id="track-heading">Check your<br /><span>registration status.</span></h1>
            <p>Enter your submission reference number to check the latest status.</p>
          </div>
        </section>

        <section className="cm-track-content" aria-label="Track your registration">
          <div className="cm-track-search-card">
            <div className="cm-track-card-heading"><span className="cm-track-icon"><Search size={23} aria-hidden="true" /></span><div><span className="cm-home-section-label">CHECK YOUR PROGRESS</span><h2>Track your status</h2></div></div>
            <form onSubmit={handleSearch}>
              <label htmlFor="track-reference">Registration reference number</label>
              <div className="cm-track-field-row"><input id="track-reference" type="text" value={reference} onChange={(event) => { setReference(event.target.value); setTracking(null); setSearchedReference(''); setError(''); }} placeholder="e.g. CMREG400000" autoComplete="off" spellCheck={false} required disabled={loading} aria-describedby="track-hint" /><button className="cm-home-button cm-home-button-primary" type="submit" disabled={loading}>{loading ? <Clock3 className="cm-track-spin" size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}{loading ? 'Checking…' : 'Track status'}<ArrowRight size={16} aria-hidden="true" /></button></div>
              <p id="track-hint">Find this number on your submission confirmation.</p>
            </form>
          </div>

          <div className="cm-track-feedback" aria-live="polite" aria-busy={loading}>
            {error && <div className="cm-track-alert cm-track-alert-error" role="alert"><AlertCircle size={20} aria-hidden="true" /><div><strong>We couldn’t check your status.</strong><p>{error}</p></div></div>}
            {!loading && searchedReference && !tracking && !error && <div className="cm-track-alert cm-track-alert-empty"><AlertCircle size={20} aria-hidden="true" /><div><strong>No registration found</strong><p>We couldn’t find a submission for <b>{searchedReference}</b>. Check the reference number and try again.</p></div></div>}
            {tracking && <div className="cm-track-result" ref={resultRef} tabIndex={-1} role="region" aria-labelledby="track-result-heading">
              <div className="cm-track-result-top"><div><span className="cm-home-section-label">LATEST UPDATE</span><h2 id="track-result-heading">Registration status</h2><p>Reference <strong>{tracking.reference_no}</strong></p></div><span className={`cm-track-status cm-track-status-${tracking.status.toLowerCase()}`}>{tracking.status === 'SUCCESS' ? <CheckCircle2 size={16} /> : tracking.status === 'REJECTED' ? <AlertCircle size={16} /> : <Clock3 size={16} />}{tracking.status === 'SUCCESS' ? 'Successful' : tracking.status === 'REJECTED' ? 'Rejected' : 'In progress'}</span></div>
              <div className="cm-track-summary"><div><span>Registration type</span><strong>{registrationLabels[tracking.registration_type]}</strong></div><div><span>Company</span><strong>{tracking.company_name || '—'}</strong></div><div><span>Facility / port</span><strong>{portLabels[tracking.port_location]}</strong></div><div><span>Submitted on</span><strong>{formatDate(tracking.submitted_at)}</strong></div></div>
              <div className="cm-track-timeline"><h3>Progress</h3><ol><li className="complete"><span className="cm-track-step-marker"><Check size={15} /></span><div><strong>Application submitted</strong><p>We received your registration on {formatDate(tracking.submitted_at)}.</p></div></li><li className={reviewRejected ? 'rejected' : reviewDone ? 'complete' : 'active'}><span className="cm-track-step-marker">{reviewDone ? <Check size={15} /> : reviewRejected ? <AlertCircle size={15} /> : <Clock3 size={15} />}</span><div><strong>Application review and registration</strong><p>{reviewRejected ? 'Your application was rejected.' : reviewDone ? 'Review complete.' : 'Your application is being reviewed.'}</p></div></li>{isCompany && <li className={tracking.user_email_sent ? 'complete' : 'active'}><span className="cm-track-step-marker">{tracking.user_email_sent ? <Check size={15} /> : <Mail size={15} />}</span><div><strong>{tracking.status === 'REJECTED' ? 'Rejection notification email' : 'Confirmation email'}</strong><p>{tracking.user_email_sent ? 'Email sent.' : 'Email pending.'}</p></div></li>}</ol></div>
              <div className={`cm-track-outcome cm-track-outcome-${tracking.status.toLowerCase()}`}>{tracking.status === 'SUCCESS' ? <CheckCircle2 size={20} /> : tracking.status === 'REJECTED' ? <AlertCircle size={20} /> : <Clock3 size={20} />}<p>{tracking.status === 'SUCCESS' ? `Your registration is successful${isCompany ? ' and the confirmation email has been sent.' : '.'}` : tracking.status === 'REJECTED' ? 'This registration was rejected. Please contact CargoMove Support if you need more information.' : 'Your application is being processed. Company registrations are successful after approval and the confirmation email is sent.'}</p></div>
            </div>}
          </div>

        </section>
      </main>
      <footer className="cm-track-footer"><PortalFooterBottom /></footer>
    </div>
  );
}

