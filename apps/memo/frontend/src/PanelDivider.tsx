import { useRef } from 'react';

interface Props {
  side: 'left' | 'right';
  label: string;
  width: number;
  min: number;
  max: number;
  resize: (width: number) => void;
}

export function PanelDivider({ side, label, width, min, max, resize }: Props) {
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const sign = side === 'left' ? 1 : -1;
  const setWidth = (next: number) => resize(Math.max(min, Math.min(max, Math.round(next))));
  return (
    <div
      className={`panel-divider panel-divider-${side}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          width: event.currentTarget.parentElement?.clientWidth ?? width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const point = drag.current;
        if (point?.pointer === event.pointerId)
          setWidth(point.width + sign * (event.clientX - point.x));
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!delta) return;
        event.preventDefault();
        setWidth((event.currentTarget.parentElement?.clientWidth ?? width) + sign * delta * 16);
      }}
    />
  );
}
