import { useEffect, useEffectEvent, useState } from 'react';
import type { ReactNode } from 'react';
import { IconButton } from './IconButton';

export function Toast({
  children,
  kind,
  action,
  onDismiss,
}: {
  children: ReactNode;
  kind: 'success' | 'error';
  action?: { label: string; run: () => void; disabled?: boolean };
  onDismiss: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = useEffectEvent(onDismiss);
  const paused = hovered || focused;
  const lifetime = kind === 'error' || action ? 10000 : 6000;
  useEffect(() => {
    if (closing || paused) return;
    const timer = window.setTimeout(() => setClosing(true), lifetime);
    return () => window.clearTimeout(timer);
  }, [closing, paused, lifetime]);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => dismiss(), 180);
    return () => window.clearTimeout(timer);
  }, [closing]);
  return (
    <div
      className={`memo-toast memo-toast-${kind}${closing ? ' memo-toast-closing' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      inert={closing}
    >
      <span className="memo-toast-symbol" aria-hidden="true">
        {kind === 'error' ? '!' : '✓'}
      </span>
      <div className="memo-toast-body">
        <div role={kind === 'error' ? 'alert' : 'status'}>{children}</div>
        {action && (
          <button
            type="button"
            className="text-button"
            onClick={action.run}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        )}
      </div>
      <IconButton
        icon="close"
        iconSize={16}
        label="Скрыть уведомление"
        onClick={() => setClosing(true)}
      />
    </div>
  );
}
