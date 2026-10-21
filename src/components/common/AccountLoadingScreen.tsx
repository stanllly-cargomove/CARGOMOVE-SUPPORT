import React from 'react';
import cargoMoveMark from '../../../media/cargomove-favicon.webp';

export function AccountLoadingScreen() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-md" role="status" aria-busy="true" aria-label="Loading account">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div aria-hidden="true" className="absolute inset-0 rounded-full border-[3px] border-sky-500/15 border-t-sky-500 border-r-sky-500/60 motion-safe:animate-spin" />
        <img src={cargoMoveMark} alt="CargoMove" className="h-16 w-16 object-contain drop-shadow-sm motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
