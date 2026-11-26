import { useLayoutEffect, useRef } from 'react';
import type { ComponentProps, RefObject } from 'react';
import { createPortal } from 'react-dom';

interface Props extends Omit<ComponentProps<'dialog'>, 'ref' | 'open' | 'onCancel'> {
  locked?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  dismiss: () => void;
}

function outside(dialog: HTMLDialogElement, x: number, y: number) {
  const rect = dialog.getBoundingClientRect();
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

export function Modal({ locked, initialFocus, dismiss, className = '', ...props }: Props) {
  const root = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    element.showModal();
    initialFocus?.current?.focus();
    return () => element.close();
  }, [initialFocus]);
  return createPortal(
    <dialog
      {...props}
      ref={root}
      className={`ui-modal ${className}`.trim()}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) dismiss();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        backdropPress.current =
          event.button === 0 &&
          event.target === event.currentTarget &&
          outside(event.currentTarget, event.clientX, event.clientY);
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (
          !locked &&
          backdropPress.current &&
          event.target === event.currentTarget &&
          outside(event.currentTarget, event.clientX, event.clientY)
        )
          dismiss();
        backdropPress.current = false;
      }}
    />,
    document.body,
  );
}
