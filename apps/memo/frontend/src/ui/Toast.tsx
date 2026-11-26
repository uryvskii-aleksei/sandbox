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
  return (
    <div className={`memo-toast memo-toast-${kind}`}>
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
      <IconButton icon="close" iconSize={16} label="Скрыть уведомление" onClick={onDismiss} />
    </div>
  );
}
