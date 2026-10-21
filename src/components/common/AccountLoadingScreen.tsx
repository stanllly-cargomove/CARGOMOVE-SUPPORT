import React from 'react';

export function AccountLoadingScreen() {
  return (
    <div className="fixed inset-0 z-[100] backdrop-blur-md" role="status" aria-busy="true" aria-label="Loading account" />
  );
}
