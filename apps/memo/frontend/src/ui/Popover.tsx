import { useEffect, useRef } from 'react';
import type { ComponentProps, RefObject } from 'react';

const openPopovers: HTMLDivElement[] = [];

interface Props extends Omit<ComponentProps<'div'>, 'ref'> {
  elementRef?: RefObject<HTMLDivElement | null>;
  trigger?: RefObject<HTMLElement | SVGElement | null>;
  locked?: boolean;
  onDismiss: () => void;
}

export function Popover({
  elementRef,
  trigger,
  locked = false,
  onDismiss,
  className = '',
  ...props
}: Props) {
  const local = useRef<HTMLDivElement>(null);
  const root = elementRef ?? local;
  const state = useRef({ trigger, locked, onDismiss });
  state.current = { trigger, locked, onDismiss };
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    openPopovers.push(element);
    const outside = (event: PointerEvent) => {
      const { trigger, locked, onDismiss } = state.current;
      if (locked || !(event.target instanceof Node)) return;
      if (!element.contains(event.target) && !trigger?.current?.contains(event.target)) onDismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      const modal = Array.from(document.querySelectorAll('dialog[open]:modal')).at(-1);
      if (modal && !modal.contains(element)) return;
      if (openPopovers.at(-1) !== element) return;
      event.preventDefault();
      event.stopPropagation();
      const { trigger, locked, onDismiss } = state.current;
      if (!locked) {
        trigger?.current?.focus();
        onDismiss();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      openPopovers.splice(openPopovers.indexOf(element), 1);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [root]);
  return <div {...props} ref={root} className={`ui-popover ${className}`.trim()} />;
}
