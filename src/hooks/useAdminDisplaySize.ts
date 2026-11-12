import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cargomove.admin.display-size';
export const ADMIN_DISPLAY_SIZES = ['auto', '100', '115', '125', '150'] as const;
export type AdminDisplaySize = typeof ADMIN_DISPLAY_SIZES[number];
function savedDisplaySize(): AdminDisplaySize {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return ADMIN_DISPLAY_SIZES.includes(value as AdminDisplaySize) ? value as AdminDisplaySize : 'auto';
  } catch { return 'auto'; }
}

export function useAdminDisplaySize() {
  const [displaySize, setDisplaySize] = useState<AdminDisplaySize>(savedDisplaySize);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    const sync = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) setDisplaySize(savedDisplaySize()); };
    window.addEventListener('resize', resize);
    window.addEventListener('storage', sync);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.removeEventListener('storage', sync); };
  }, []);
  // Use the available CSS viewport, not screen inches or devicePixelRatio: OS and
  // browser scaling already affect that viewport. Mobile/tablet stay at 100%.
  const autoScale = Math.min(1.5, Math.max(1, width / 1600));
  const scale = width < 1280 ? 1 : displaySize === 'auto' ? autoScale : Number(displaySize) / 100;
  const chooseDisplaySize = (value: AdminDisplaySize) => {
    if (!ADMIN_DISPLAY_SIZES.includes(value)) return;
    setDisplaySize(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Preferences are optional when storage is unavailable. */ }
  };
  return { displaySize, scale, chooseDisplaySize };
}
