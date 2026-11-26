import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Popover } from './ui';
import type { IconName } from './ui/Icon';

export interface BoardMenuItem {
  label: string;
  icon: IconName;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function BoardContextMenu({
  x,
  y,
  label,
  items,
  dismiss,
}: {
  x: number;
  y: number;
  label: string;
  items: BoardMenuItem[];
  dismiss: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const position = () => {
      const { width, height } = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    };
    position();
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [x, y]);
  return createPortal(
    <Popover
      className="board-context-menu"
      role="menu"
      aria-label={label}
      elementRef={menu}
      onDismiss={dismiss}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Tab') {
          dismiss();
          return;
        }
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        );
        if (!buttons.length) return;
        const index = buttons.findIndex((button) => button === document.activeElement);
        if (event.key === 'Home') buttons[0].focus();
        else if (event.key === 'End') buttons.at(-1)?.focus();
        else if (event.key === 'ArrowDown') buttons[(index + 1) % buttons.length].focus();
        else if (event.key === 'ArrowUp')
          buttons[(index + buttons.length - 1) % buttons.length].focus();
        else return;
        event.preventDefault();
      }}
    >
      {items.map(({ label, icon, disabled, danger, action }) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={disabled}
          className={danger ? 'danger' : undefined}
          onClick={() => {
            dismiss();
            action();
          }}
        >
          <Icon name={icon} size={16} />
          {label}
        </button>
      ))}
    </Popover>,
    document.body,
  );
}
