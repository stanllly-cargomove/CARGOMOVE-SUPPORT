import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot } from 'lucide-react';

const TOOLTIP_TITLE = 'AUTO REGISTER BY SYSTEM';
const SCHEDULED_TOOLTIP = 'The system will automatically process this scheduled registration in CargoMove.';
const FAILED_TOOLTIP = 'Automatic registration failed twice or could not be retried safely. Review the registration and CargoMove result.';
const VIEWPORT_EDGE_PADDING = 8;
const TOOLTIP_GAP = 4;

export function AutoRegisterScheduledIndicator({ failed = false }: { failed?: boolean }) {
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = React.useRef<HTMLSpanElement | null>(null);
  const tooltipId = React.useId();
  const message = failed ? FAILED_TOOLTIP : SCHEDULED_TOOLTIP;
  const accessibleLabel = failed ? message : `${TOOLTIP_TITLE}. ${message}`;

  const showTooltip = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, window.innerWidth - VIEWPORT_EDGE_PADDING * 2);
    setPosition({
      top: rect.bottom + TOOLTIP_GAP,
      left: Math.min(rect.right + TOOLTIP_GAP, window.innerWidth - width - VIEWPORT_EDGE_PADDING),
      width,
    });
  };

  return (
    <span ref={containerRef} className="relative inline-flex" aria-describedby={position ? tooltipId : undefined}
      onMouseEnter={showTooltip} onMouseLeave={() => setPosition(null)}
      onFocusCapture={showTooltip} onBlurCapture={() => setPosition(null)}>
      <span role="img" aria-label={accessibleLabel} tabIndex={0}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 ${failed ? 'bg-red-100 text-red-700 hover:bg-red-200 focus-visible:ring-red-500' : 'bg-blue-100 text-blue-700 hover:bg-blue-200 focus-visible:ring-blue-500'}`}>
        <Bot aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
      {position && createPortal(
        <div id={tooltipId} role="tooltip" className="pointer-events-none fixed z-[80] rounded-lg bg-slate-900 px-3 py-2 text-xs leading-5 text-white shadow-xl"
          style={{ top: position.top, left: position.left, width: position.width }}>
          {!failed && <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-blue-200">{TOOLTIP_TITLE}</span>}
          <span className="block">{message}</span>
        </div>,
        document.body,
      )}
    </span>
  );
}
