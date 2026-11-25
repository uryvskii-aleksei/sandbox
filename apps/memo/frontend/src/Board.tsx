import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';

import type { Card } from './types';

interface Props {
  cards: Card[];
  busy: boolean;
  open: (card: Card) => void;
  child: (card: Card) => void;
  position: (card: Card) => Promise<void>;
}
interface Drag {
  card: Card | null;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function Board({ cards, busy, open, child, position }: Props) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 30, y: 30 });
  const [temporary, setTemporary] = useState<Record<number, Card['coordinates']>>({});
  const drag = useRef<Drag | null>(null);
  const point = (card: Card) => temporary[card.id] ?? card.coordinates;
  const start = (event: PointerEvent<HTMLElement>, card: Card | null) => {
    if (
      busy ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button:not(.card-title)'))
    )
      return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = card ? point(card) : pan;
    drag.current = {
      card,
      x: event.clientX,
      y: event.clientY,
      startX: origin.x,
      startY: origin.y,
      moved: false,
    };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || busy) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    current.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
    if (current.card) {
      const id = current.card.id;
      setTemporary((values) => ({
        ...values,
        [id]: { x: current.startX + dx / scale, y: current.startY + dy / scale },
      }));
    } else setPan({ x: current.startX + dx, y: current.startY + dy });
  };
  const end = async (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const current = drag.current;
    drag.current = null;
    if (!current?.card) return;
    const card = current.card;
    if (current.moved && !cancelled) {
      const coordinates = {
        x: current.startX + (event.clientX - current.x) / scale,
        y: current.startY + (event.clientY - current.y) / scale,
      };
      try {
        await position({ ...card, coordinates });
      } finally {
        setTemporary((values) => {
          const next = { ...values };
          delete next[card.id];
          return next;
        });
      }
    } else {
      setTemporary((values) => {
        const next = { ...values };
        delete next[card.id];
        return next;
      });
      if (!cancelled) open(card);
    }
  };
  return (
    <section
      className="board"
      aria-label="Полотно проекта"
      onPointerDown={(event) => start(event, null)}
      onPointerMove={move}
      onPointerUp={(event) => void end(event)}
      onPointerCancel={(event) => void end(event, true)}
    >
      <div className="board-hint">
        Перетаскивайте карточки и фон. Откройте карточку, чтобы добавить содержание.
      </div>
      <div
        className="board-world"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
      >
        <svg className="connections" width="10000" height="10000" aria-hidden="true">
          {cards.map((card) => {
            const parent = cards.find((item) => item.id === card.parent);
            if (!parent) return null;
            const a = point(parent);
            const b = point(card);
            return <line key={card.id} x1={a.x + 50} y1={a.y + 50} x2={b.x + 50} y2={b.y + 50} />;
          })}
        </svg>
        {cards.map((card) => (
          <div
            className={`mind-card ${card.parent ? 'child-card' : ''}`}
            key={card.id}
            style={{ left: point(card).x, top: point(card).y }}
            onPointerDown={(event) => start(event, card)}
          >
            <span className="card-eyebrow">{card.parent ? 'СВЯЗАННАЯ МЫСЛЬ' : 'МЫСЛЬ'}</span>
            <button
              className="card-title"
              disabled={busy}
              onClick={(event) => {
                // Pointer открывает карточку в end, клавиатура — штатным click.
                if (event.detail === 0) open(card);
              }}
            >
              <span title={card.name}>{card.name}</span>
            </button>
            <div className="card-bottom">
              <span>{card.content.length} групп</span>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={`Добавить дочернюю карточку к ${card.name}`}
                onClick={() => child(card)}
              >
                ＋
              </button>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={`Открыть карточку ${card.name}`}
                onClick={() => open(card)}
              >
                ↗
              </button>
            </div>
          </div>
        ))}
      </div>
      {!cards.length && (
        <div className="board-empty">
          <span>✧</span>
          <h2>Здесь начинаются ваши идеи</h2>
          <p>Добавьте первую мысль и свяжите её с другими.</p>
        </div>
      )}
      <div className="zoom-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button
          aria-label="Уменьшить масштаб"
          onClick={() => setScale((value) => Math.max(0.35, value - 0.1))}
        >
          −
        </button>
        <input
          aria-label="Масштаб полотна"
          type="range"
          min="0.35"
          max="1.6"
          step="0.05"
          value={scale}
          onChange={(event) => setScale(Number(event.target.value))}
        />
        <span>{Math.round(scale * 100)}%</span>
        <button
          aria-label="Сбросить положение и масштаб"
          onClick={() => {
            setScale(1);
            setPan({ x: 30, y: 30 });
          }}
        >
          ⌂
        </button>
      </div>
    </section>
  );
}
