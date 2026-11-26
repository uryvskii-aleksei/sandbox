import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, SVGAttributes } from 'react';
import { api } from './api';
import type { BoardMark, BoardMarkUpdate, Card, NewBoardMark, Sketch } from './types';
import { markTools } from './shortcuts';
import { IconButton } from './ui';

type Point = Card['coordinates'];
const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
type Corner = (typeof corners)[number];
type Handle = 'at' | 'end' | 'body' | Corner;
const isCorner = (handle: Handle): handle is Corner =>
  handle !== 'at' && handle !== 'end' && handle !== 'body';
const cornerNames: Record<Corner, string> = {
  'top-left': 'Верхний левый угол',
  'top-right': 'Верхний правый угол',
  'bottom-left': 'Нижний левый угол',
  'bottom-right': 'Нижний правый угол',
};
type Gesture = {
  pointer: number;
  mark: BoardMark;
  handle: Handle;
  origin: Point;
  moved: boolean;
  box: DOMRect | null;
};

const limit = 100000;
function equalSides(anchor: Point, target: Point): Point {
  const dx = target.x - anchor.x;
  const dy = target.y - anchor.y;
  const size = Math.min(
    Math.max(Math.abs(dx), Math.abs(dy)),
    dx < 0 ? limit + anchor.x : limit - anchor.x,
    dy < 0 ? limit + anchor.y : limit - anchor.y,
  );
  return { x: anchor.x + (dx < 0 ? -size : size), y: anchor.y + (dy < 0 ? -size : size) };
}

function sketchSize(sketch: Sketch): number {
  const width = Math.abs(sketch.end.x - sketch.at.x);
  const height = Math.abs(sketch.end.y - sketch.at.y);
  return sketch.kind === 'line' ? Math.hypot(width, height) : Math.min(width, height);
}

function rectangleCorner({ at, end }: Sketch, corner: Corner, opposite = false): Point {
  const horizontal = corner.endsWith('left') !== opposite ? Math.min : Math.max;
  const vertical = corner.startsWith('top') !== opposite ? Math.min : Math.max;
  return { x: horizontal(at.x, end.x), y: vertical(at.y, end.y) };
}

const fitLabelScale = (value: number) => Math.round(Math.max(0.4, Math.min(4, value)) * 100) / 100;
const labelStyle = (scale = 1): CSSProperties & { '--label-scale': number } => ({
  '--label-scale': scale,
});

function moveMark(
  mark: BoardMark,
  handle: Handle,
  dx: number,
  dy: number,
  constrain: boolean,
): BoardMark {
  const shift = (point: Point) => ({
    x: Math.max(-limit, Math.min(limit, point.x + dx)),
    y: Math.max(-limit, Math.min(limit, point.y + dy)),
  });
  if (isCorner(handle)) {
    if (mark.kind !== 'square') return mark;
    const anchor = rectangleCorner(mark, handle, true);
    const target = shift(rectangleCorner(mark, handle));
    return { ...mark, at: anchor, end: constrain ? equalSides(anchor, target) : target };
  }
  if (mark.kind === 'label') return { ...mark, at: shift(mark.at) };
  if (handle !== 'body') {
    const target = shift(mark[handle]);
    const anchor = handle === 'at' ? mark.end : mark.at;
    return { ...mark, [handle]: mark.kind === 'line' ? target : equalSides(anchor, target) };
  }
  dx = Math.max(
    -limit - Math.min(mark.at.x, mark.end.x),
    Math.min(limit - Math.max(mark.at.x, mark.end.x), dx),
  );
  dy = Math.max(
    -limit - Math.min(mark.at.y, mark.end.y),
    Math.min(limit - Math.max(mark.at.y, mark.end.y), dy),
  );
  return { ...mark, at: shift(mark.at), end: shift(mark.end) };
}

export function useCanvasMarks(project: number, folder: number | null) {
  const [items, setItems] = useState<BoardMark[]>([]);
  const [tool, setTool] = useState<BoardMark['kind'] | null>(null);
  const [draft, setDraft] = useState<{
    at: Point;
    text: string;
    scale?: number;
    id?: number;
  } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<Sketch | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const drawing = useRef<Sketch | null>(null);
  const blocked = useRef(false);
  const retrySave = useRef<(() => void) | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void api
      .marks(project, folder, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setItems(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Не удалось загрузить разметку полотна.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [project, folder, revision]);

  const cancel = () => {
    if (blocked.current) return;
    setTool(null);
    setDraft(null);
    setSelected(null);
    drawing.current = null;
    setPreview(null);
  };
  const run = async (work: () => Promise<void>) => {
    if (blocked.current) return;
    blocked.current = true;
    setError('');
    setSaving(true);
    retrySave.current = () => void run(work);
    try {
      await work();
      retrySave.current = null;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить разметку.');
    } finally {
      blocked.current = false;
      setSaving(false);
    }
  };
  const retry = () => {
    if (retrySave.current) retrySave.current();
    else {
      setError('');
      setRevision((value) => value + 1);
    }
  };
  const replace = (saved: BoardMark) =>
    setItems((current) =>
      current.some((mark) => mark.id === saved.id)
        ? current.map((mark) => (mark.id === saved.id ? saved : mark))
        : [...current, saved],
    );
  const store = (mark: NewBoardMark) => {
    const requestId = crypto.randomUUID();
    return run(async () => {
      replace(await api.createMark(project, folder, mark, requestId));
      setDraft(null);
    });
  };
  const update = (mark: number, patch: BoardMarkUpdate) =>
    run(async () => {
      replace(await api.editMark(mark, patch));
    });
  const arm = (next: BoardMark['kind']) => {
    if (blocked.current || loading) return;
    cancel();
    setTool(tool === next ? null : next);
  };
  const choose = (mark: BoardMark, edit = true) => {
    if (blocked.current) return;
    setSelected(mark.id);
    setDraft(
      mark.kind === 'label' && edit
        ? { id: mark.id, at: mark.at, text: mark.text, scale: mark.scale }
        : null,
    );
  };
  const placeLabel = (at: Point) => {
    if (blocked.current || loading) return;
    setDraft({ at, text: '' });
    setTool(null);
  };
  const start = (at: Point) => {
    if (tool && tool !== 'label' && !drawing.current) {
      drawing.current = { kind: tool, at, end: at };
      setPreview(drawing.current);
    } else if (tool === 'label') placeLabel(at);
  };
  const move = (end: Point, straight: boolean) => {
    const current = drawing.current;
    if (!current) return false;
    if (current.kind === 'circle' || (current.kind === 'square' && straight)) {
      end = equalSides(current.at, end);
    } else if (current.kind === 'line' && straight) {
      const horizontal = Math.abs(end.x - current.at.x) >= Math.abs(end.y - current.at.y);
      end = horizontal ? { x: end.x, y: current.at.y } : { x: current.at.x, y: end.y };
    }
    drawing.current = { ...current, end };
    setPreview(drawing.current);
    return true;
  };
  const finish = (cancelled: boolean) => {
    const sketch = drawing.current;
    if (!sketch) return;
    if (cancelled) {
      cancel();
      return;
    }
    if (sketchSize(sketch) < 4) return;
    drawing.current = null;
    setPreview(null);
    setTool(null);
    void store(sketch);
  };
  const setText = (text: string) => setDraft((current) => current && { ...current, text });
  const saveLabel = () => {
    if (!draft || !draft.text.trim() || blocked.current) return;
    const text = draft.text.trim();
    if (draft.id === undefined) void store({ kind: 'label', at: draft.at, text });
    else {
      const id = draft.id;
      void run(async () => {
        replace(await api.editMark(id, { text }));
        setDraft(null);
      });
    }
  };
  const remove = (id = selected) => {
    if (id === null) return;
    void run(async () => {
      await api.deleteMark(id);
      setItems((current) => current.filter((item) => item.id !== id));
      setDraft((current) => (current?.id === id ? null : current));
      setSelected((current) => (current === id ? null : current));
    });
  };
  return {
    items,
    tool,
    arm,
    start,
    placeLabel,
    store,
    move,
    finish,
    choose,
    draft,
    setText,
    saveLabel,
    selected,
    remove,
    preview,
    error,
    retry,
    cancel,
    update,
    locked: loading || saving,
  };
}

type Marks = ReturnType<typeof useCanvasMarks>;

export function MarkTools({
  marks,
  busy,
  arm,
}: {
  marks: Marks;
  busy: boolean;
  arm: (tool: NonNullable<Marks['tool']>) => void;
}) {
  return (
    <>
      {markTools.map(({ kind, icon, label, key }) => (
        <IconButton
          key={kind}
          icon={icon}
          label={label}
          tooltip={`${label} · Alt+Shift+${key}${kind === 'square' ? ' · Shift — квадрат' : ''}`}
          className="secondary"
          aria-pressed={marks.tool === kind}
          aria-keyshortcuts={`Alt+Shift+${key}`}
          disabled={busy || marks.locked}
          onClick={() => arm(kind)}
        />
      ))}
    </>
  );
}

function MarkStroke({ sketch, ...props }: { sketch: Sketch } & SVGAttributes<SVGElement>) {
  const { kind, at, end } = sketch;
  if (kind === 'line') return <line {...props} x1={at.x} y1={at.y} x2={end.x} y2={end.y} />;
  const width = Math.abs(end.x - at.x);
  const x = Math.min(at.x, end.x);
  const y = Math.min(at.y, end.y);
  if (kind === 'square')
    return <rect {...props} x={x} y={y} width={width} height={Math.abs(end.y - at.y)} />;
  return <circle {...props} cx={x + width / 2} cy={y + width / 2} r={width / 2} />;
}

const sketchNames: Record<Sketch['kind'], string> = {
  line: 'Линия разметки',
  square: 'Прямоугольник разметки',
  circle: 'Круг разметки',
};
const sketchTrash: Record<Sketch['kind'], string> = {
  line: 'Удалить линию',
  square: 'Удалить прямоугольник',
  circle: 'Удалить круг',
};

export function MarkLayer({
  marks,
  scale,
  busy,
  group,
}: {
  marks: Marks;
  scale: number;
  busy: boolean;
  group: number[];
}) {
  const gesture = useRef<Gesture | null>(null);
  const [moving, setMoving] = useState<BoardMark | null>(null);
  const start = (
    event: PointerEvent<SVGElement | HTMLButtonElement>,
    mark: BoardMark,
    handle: Handle,
  ) => {
    if (busy || marks.locked || marks.tool || gesture.current || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      pointer: event.pointerId,
      mark,
      handle,
      origin: { x: event.clientX, y: event.clientY },
      moved: false,
      box:
        mark.kind === 'label' && isCorner(handle)
          ? (event.currentTarget.parentElement?.getBoundingClientRect() ?? null)
          : null,
    };
  };
  const displacement = (event: PointerEvent, current: Gesture) => ({
    x: event.clientX - current.origin.x,
    y: event.clientY - current.origin.y,
  });
  const movedMark = (current: Gesture, dx: number, dy: number, constrain: boolean): BoardMark => {
    const { mark, handle, box } = current;
    if (isCorner(handle) && mark.kind === 'label' && box && box.width && box.height) {
      const left = handle.endsWith('left');
      const top = handle.startsWith('top');
      const oldScale = mark.scale ?? 1;
      const ratio =
        1 +
        ((left ? -dx : dx) * box.width + (top ? -dy : dy) * box.height) /
          (box.width ** 2 + box.height ** 2);
      const next = fitLabelScale(oldScale * ratio);
      const change = (1 - next / oldScale) / scale;
      const bound = (value: number) => Math.max(-limit, Math.min(limit, value));
      return {
        ...mark,
        scale: next,
        at: {
          x: bound(mark.at.x + (left ? box.width * change : 0)),
          y: bound(mark.at.y + (top ? box.height * change : 0)),
        },
      };
    }
    return moveMark(mark, handle, dx / scale, dy / scale, constrain);
  };
  const move = (event: PointerEvent) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointer) return;
    event.stopPropagation();
    const { x, y } = displacement(event, current);
    current.moved ||= Math.abs(x) + Math.abs(y) > 4;
    if (current.moved) setMoving(movedMark(current, x, y, event.shiftKey));
  };
  const persist = async (mark: BoardMark, handle: Handle) => {
    if (mark.kind !== 'label' && sketchSize(mark) < 1) {
      setMoving(null);
      return;
    }
    await marks.update(
      mark.id,
      mark.kind === 'label'
        ? isCorner(handle)
          ? { scale: mark.scale, at: mark.at }
          : { at: mark.at }
        : { at: mark.at, end: mark.end },
    );
    setMoving(null);
  };
  const finish = (event: PointerEvent, cancelled = false) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointer) return;
    event.stopPropagation();
    gesture.current = null;
    if (cancelled) {
      setMoving(null);
      return;
    }
    const { x, y } = displacement(event, current);
    const moved = current.moved || Math.abs(x) + Math.abs(y) > 4;
    marks.choose(current.mark, !moved && current.handle === 'body');
    if (moved) void persist(movedMark(current, x, y, event.shiftKey), current.handle);
  };
  const keys = (event: KeyboardEvent, mark: BoardMark, handle: Handle) => {
    if (busy || marks.locked || marks.tool) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      marks.choose(mark, handle === 'body');
      return;
    }
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    marks.choose(mark, false);
    const next =
      isCorner(handle) && mark.kind === 'label'
        ? { ...mark, scale: fitLabelScale((mark.scale ?? 1) + (dx + dy) / 10) }
        : moveMark(mark, handle, dx * 8, dy * 8, event.shiftKey);
    void persist(next, handle);
  };
  const pointer = (mark: BoardMark, handle: Handle = 'body') => ({
    onPointerDown: (event: PointerEvent<SVGElement | HTMLButtonElement>) =>
      start(event, mark, handle),
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: (event: PointerEvent) => finish(event, true),
    onKeyDown: (event: KeyboardEvent) => keys(event, mark, handle),
  });
  const items = marks.items.map((mark) => (moving?.id === mark.id ? moving : mark));
  const trash = (mark: BoardMark, label: string) => (
    <IconButton
      className="canvas-trash"
      icon="trash"
      iconSize={15}
      label={label}
      disabled={busy || marks.locked || !!marks.tool}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => marks.remove(mark.id)}
    />
  );
  return (
    <>
      <svg className="mark-lines" width="1" height="1" aria-label="Разметка полотна">
        {items.map((mark) => {
          if (mark.kind === 'label') return null;
          const selected = marks.selected === mark.id || moving?.id === mark.id;
          const grouped = group.includes(mark.id);
          const middleX = (mark.at.x + mark.end.x) / 2;
          const middleY = (mark.at.y + mark.end.y) / 2;
          const handles = mark.kind === 'square' ? corners : (['at', 'end'] as const);
          return (
            <g
              key={mark.id}
              data-kind={mark.kind}
              data-active={selected || undefined}
              data-menu-mark={mark.id}
            >
              <MarkStroke
                sketch={mark}
                className={`mark-stroke ${grouped ? 'mark-grouped' : ''}`}
                data-mark-id={mark.id}
              />
              <MarkStroke
                sketch={mark}
                className="mark-hit"
                role="button"
                tabIndex={0}
                aria-label={sketchNames[mark.kind]}
                aria-pressed={selected || grouped}
                {...pointer(mark)}
              />
              <foreignObject
                className="mark-trash"
                width={27}
                height={27}
                x={mark.kind === 'circle' ? Math.max(mark.at.x, mark.end.x) - 5 : middleX - 13.5}
                y={
                  mark.kind === 'square'
                    ? Math.min(mark.at.y, mark.end.y) - 25
                    : middleY - (mark.kind === 'line' ? 30 : 14)
                }
              >
                {trash(mark, sketchTrash[mark.kind])}
              </foreignObject>
              {handles.map((handle) => {
                const point = isCorner(handle) ? rectangleCorner(mark, handle) : mark[handle];
                const name = isCorner(handle)
                  ? `${cornerNames[handle]} прямоугольника`
                  : mark.kind === 'line'
                    ? handle === 'at'
                      ? 'Начало линии разметки'
                      : 'Конец линии разметки'
                    : handle === 'at'
                      ? 'Первый угол фигуры'
                      : 'Противоположный угол фигуры';
                return (
                  <rect
                    key={handle}
                    className={`mark-endpoint ${handle}`}
                    role="button"
                    tabIndex={0}
                    aria-label={name}
                    x={point.x - 6}
                    y={point.y - 6}
                    width={12}
                    height={12}
                    rx={2}
                    {...pointer(mark, handle)}
                  />
                );
              })}
            </g>
          );
        })}
        {marks.preview && (
          <MarkStroke sketch={marks.preview} className="mark-stroke mark-preview" />
        )}
      </svg>
      {items.map(
        (mark) =>
          mark.kind === 'label' &&
          marks.draft?.id !== mark.id && (
            <div
              key={mark.id}
              className="canvas-label-item"
              data-mark-id={mark.id}
              data-menu-mark={mark.id}
              style={{ left: mark.at.x, top: mark.at.y, ...labelStyle(mark.scale) }}
            >
              <button
                type="button"
                className="canvas-label"
                aria-pressed={marks.selected === mark.id || group.includes(mark.id)}
                {...pointer(mark)}
              >
                {mark.text}
              </button>
              <div className="mark-trash">{trash(mark, `Удалить подпись «${mark.text}»`)}</div>
              {corners.map((corner) => (
                <button
                  key={corner}
                  type="button"
                  className={`canvas-label-resize ${corner}`}
                  aria-label={`Изменить размер подписи «${mark.text}»`}
                  aria-hidden={corner === 'bottom-right' ? undefined : true}
                  tabIndex={corner === 'bottom-right' ? 0 : -1}
                  aria-keyshortcuts={
                    corner === 'bottom-right' ? 'ArrowLeft ArrowRight ArrowUp ArrowDown' : undefined
                  }
                  disabled={busy || marks.locked}
                  {...pointer(mark, corner)}
                />
              ))}
            </div>
          ),
      )}
      {marks.draft && (
        <form
          className="canvas-label-editor"
          style={{
            left: marks.draft.at.x,
            top: marks.draft.at.y,
            ...labelStyle(marks.draft.scale),
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            marks.saveLabel();
          }}
        >
          <input
            key={marks.draft.id ?? 'new'}
            autoFocus
            className="canvas-label"
            aria-label="Текст подписи"
            maxLength={128}
            value={marks.draft.text}
            readOnly={busy || marks.locked}
            style={{
              width: `clamp(calc(150px * var(--label-scale)), ${marks.draft.text.length + 1}ch, calc(380px * var(--label-scale)))`,
            }}
            onChange={(event) => marks.setText(event.target.value)}
          />
        </form>
      )}
    </>
  );
}
