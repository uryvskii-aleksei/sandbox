import { useId } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import type { IconName } from './Icon';
import { Modal } from './Modal';

export function ConfirmDialog({
  title,
  description,
  action,
  icon,
  busy,
  error,
  dismiss,
  confirm,
}: {
  title: string;
  description: ReactNode;
  action: string;
  icon?: IconName;
  busy?: boolean;
  error?: string;
  dismiss: () => void;
  confirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <Modal
      className="confirm-dialog"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      locked={busy}
      dismiss={dismiss}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="confirm-dialog-actions">
        <Button autoFocus disabled={busy} onClick={dismiss}>
          Отмена
        </Button>
        <Button className="danger" icon={icon} disabled={busy} onClick={confirm}>
          {action}
        </Button>
      </div>
    </Modal>
  );
}
