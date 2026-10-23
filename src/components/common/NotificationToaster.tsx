import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toaster, type ToasterProps } from 'react-hot-toast';

// Native modal dialogs sit above every document z-index. Keep one notification
// host per channel, moving it into the active dialog so notices stay visible
// and accessible, then back to the document when the dialog closes.
export function NotificationToaster(props: ToasterProps) {
  const [target, setTarget] = useState<Element>(() => document.body);
  useEffect(() => {
    const update = () => {
      const dialogs = document.querySelectorAll('dialog:modal');
      const focusedDialog = document.activeElement?.closest('dialog:modal');
      setTarget(focusedDialog || dialogs.item(dialogs.length - 1) || document.body);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);
  return createPortal(<div className="admin-theme"><Toaster {...props} /></div>, target);
}
