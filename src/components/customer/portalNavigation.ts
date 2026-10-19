import { useState } from 'react';

export type PortalPage = 'home' | 'register' | 'track' | 'guideline' | 'login' | 'admin';
export interface PortalPageProps {
  onNavigate: (page: PortalPage, reference?: string) => void;
}

export const portalPaths: Record<PortalPage, string> = {
  home: '/', register: '/register', track: '/track-status', guideline: '/guideline', login: '/login', admin: '/admin',
};

export function pageFromPath(path: string): PortalPage {
  const name = path.replace(/^\/previews\//, '/').replace(/\.html$/, '').replace(/\/$/, '') || '/';
  return (Object.keys(portalPaths) as PortalPage[]).find(page => portalPaths[page] === name) || 'home';
}

export function usePortalTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('cargomove-home-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const toggleTheme = () => setTheme(current => {
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('cargomove-home-theme', next); } catch { /* Storage is optional. */ }
    return next;
  });
  return { theme, toggleTheme };
}

export function portalHeaderNavigation(onNavigate: PortalPageProps['onNavigate']) {
  return {
    homeHref: '/',
    onHome: () => onNavigate('home'),
    onRegister: () => onNavigate('register'),
    onTrackStatus: () => onNavigate('track'),
    onGuideline: () => onNavigate('guideline'),
    onLogin: () => onNavigate('login'),
  };
}
