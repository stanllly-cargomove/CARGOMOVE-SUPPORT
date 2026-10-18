import React from 'react';
import { PORTAL_VERSION } from '../../constants/versions';

export function PortalFooterBottom() {
  return (
    <div className="cm-portal-footer">
      <div className="cm-home-footer-bottom">
        <span>© {new Date().getFullYear()} CargoMove. All rights reserved.</span>
        <span>{PORTAL_VERSION}</span>
      </div>
    </div>
  );
}
