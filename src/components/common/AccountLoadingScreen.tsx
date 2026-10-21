import React from 'react';

export function AccountLoadingScreen() {
  return (
    <main className="relative min-h-screen min-h-[100dvh] overflow-hidden bg-slate-200" aria-busy="true" aria-label="Loading account">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/25 backdrop-blur-md" />
    </main>
  );
}
