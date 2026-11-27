import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  Ref,
  SVGAttributes,
} from 'react';
import { useWorkspaceClient } from './WorkspaceClient';
import type { markTools } from './shortcuts';
import type { BoardMark, BoardMarkUpdate, Card, NewBoardMark, Sketch } from './types';
import { IconButton } from './ui';

type Point = Card['coordinates'];
export type StartShapeDrag = (event: ReactPointerEvent<HTMLElement>, id: number) => boolean;
const captionGap = 8;
const shapeCaptionAnchor = ({ at, end }: Sketch): Point => ({
  x: (at.x + end.x) / 2,
  y: Math.min(at.y, end.y) - captionGap,
});
const shapeCaptionWidth = ({ at, end }: Sketch) =>
  Math.max(120, Math.min(420, Math.abs(end.x - at.x)));
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
  target: Element;
  listeners: AbortController;
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

function shapeCorner({ at, end }: Sketch, corner: Corner, opposite = false): Point {
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
    if (mark.kind !== 'square' && mark.kind !== 'circle') return mark;
    const point = shapeCorner(mark, handle);
    const anchor = shapeCorner(mark, handle, true);
    if (mark.kind === 'circle') {
      const xSign = Math.sign(point.x - anchor.x);
      const ySign = Math.sign(point.y - anchor.y);
      // Указатель меняет диаметр вдоль диагонали, противоположный угол остаётся на месте.
      const size = Math.max(1, Math.abs(point.x - anchor.x) + (dx * xSign + dy * ySign) / 2);
      const target = { x: anchor.x + size * xSign, y: anchor.y + size * ySign };
      return { ...mark, at: anchor, end: equalSides(anchor, target) };
    }
    const target = shift(point);
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
  const api = useWorkspaceClient();
  const [items, setItems] = useState<BoardMark[]>([]);
  const [tool, setTool] = useState<(typeof markTools)[number]['kind'] | null>(null);
  const [draft, setDraft] = useState<{
    id: number;
    kind: 'label' | 'square' | 'circle';
    at: Point;
    text: string;
    scale?: number;
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
  const arm = (next: NonNullable<typeof tool>) => {
    if (blocked.current || loading) return;
    cancel();
    setTool(tool === next ? null : next);
  };
  const choose = (mark: BoardMark, edit = true) => {
    if (blocked.current) return;
    setSelected(mark.id);
    setDraft(
      edit && mark.kind !== 'line'
        ? {
            id: mark.id,
            kind: mark.kind,
            at: mark.kind === 'label' ? mark.at : shapeCaptionAnchor(mark),
            text: mark.text ?? '',
            scale: mark.kind === 'label' ? mark.scale : undefined,
          }
        : null,
    );
  };
  const start = (at: Point) => {
    if (tool && !drawing.current) {
      drawing.current = { kind: tool, at, end: at };
      setPreview(drawing.current);
    }
  };
  const move = (end: Point, straight: boolean) => {
    const current = drawing.current;
    if (!current) return false;
    if (current.kind === 'circle' || (current.kind === 'square' && straight)) {
      end = equalSides(current.at, end);
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
    if (!draft || blocked.current) return;
    const text = draft.text.trim();
    if (!text && draft.kind === 'label') return;
    void run(async () => {
      replace(await api.editMark(draft.id, { text }));
      setDraft(null);
    });
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
    applyMoved(saved: BoardMark[], intoFolder: boolean) {
      const byId = new Map(saved.map((item) => [item.id, item]));
      setItems((current) =>
        current.flatMap((item) => {
          const changed = byId.get(item.id);
          return changed ? (intoFolder ? [] : [changed]) : [item];
        }),
      );
    },
    tool,
    arm,
    start,
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

function ShapeCaption({
  sketch,
  disabled,
  onEdit,
  children,
}: {
  sketch: Sketch;
  disabled: boolean;
  onEdit: () => void;
  children: ReactNode;
}) {
  const anchor = shapeCaptionAnchor(sketch);
  const width = shapeCaptionWidth(sketch) + 66;
  const height = 88;
  return (
    <foreignObject
      className="shape-caption"
      x={anchor.x - width / 2}
      y={anchor.y - height}
      width={width}
      height={height}
    >
      <div className="shape-caption-row" onPointerDown={(event) => event.stopPropagation()}>
        {sketch.text ? (
          <button
            type="button"
            className="shape-caption-text"
            aria-label={`Изменить подпись «${sketch.text}»`}
            title="Изменить подпись"
            disabled={disabled}
            onClick={onEdit}
          >
            <span>{sketch.text}</span>
          </button>
        ) : (
          <IconButton
            className="shape-caption-pencil"
            icon="pencil"
            iconSize={22.5}
            label="Добавить подпись"
            disabled={disabled}
            onClick={onEdit}
          />
        )}
        <div className="shape-caption-trash">{children}</div>
      </div>
    </foreignObject>
  );
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
  offset,
  shapeDragRef,
}: {
  marks: Marks;
  scale: number;
  busy: boolean;
  group: number[];
  offset: Point | null;
  shapeDragRef: Ref<StartShapeDrag>;
}) {
  const gesture = useRef<Gesture | null>(null);
  const captionEditor = useRef<HTMLFormElement>(null);
  const [moving, setMoving] = useState<BoardMark | null>(null);
  useEffect(() => () => gesture.current?.listeners.abort(), []);
  const start = (event: ReactPointerEvent<Element>, mark: BoardMark, handle: Handle) => {
    if (busy || marks.locked || marks.tool || gesture.current || event.button !== 0) return false;
    event.stopPropagation();
    const target = event.currentTarget;
    const listeners = new AbortController();
    target.setPointerCapture(event.pointerId);
    gesture.current = {
      pointer: event.pointerId,
      target,
      listeners,
      mark,
      handle,
      origin: { x: event.clientX, y: event.clientY },
      moved: false,
      box:
        mark.kind === 'label' && isCorner(handle)
          ? (target.parentElement?.getBoundingClientRect() ?? null)
          : null,
    };
    // Событие отпускания может попасть на полотно, если браузер потерял захват ручки.
    const options = { capture: true, signal: listeners.signal };
    window.addEventListener('pointermove', move, options);
    window.addEventListener('pointerup', (event) => finish(event), options);
    window.addEventListener('pointercancel', (event) => finish(event, true), options);
    window.addEventListener('blur', () => finish(null), { signal: listeners.signal });
    return true;
  };
  useImperativeHandle(shapeDragRef, () => (event, id) => {
    const shape = marks.items.find(
      (mark) => mark.id === id && (mark.kind === 'circle' || mark.kind === 'square'),
    );
    return shape ? start(event, shape, 'body') : false;
  });
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
  const finish = (event: PointerEvent | null, cancelled = false) => {
    const current = gesture.current;
    if (!current || (event && event.pointerId !== current.pointer)) return;
    event?.stopPropagation();
    gesture.current = null;
    current.listeners.abort();
    if (current.target.hasPointerCapture(current.pointer))
      current.target.releasePointerCapture(current.pointer);
    if (!event || cancelled) {
      setMoving(null);
      return;
    }
    const { x, y } = displacement(event, current);
    const moved = current.moved || Math.abs(x) + Math.abs(y) > 4;
    marks.choose(
      current.mark,
      current.mark.kind === 'label' && !moved && current.handle === 'body',
    );
    if (moved) void persist(movedMark(current, x, y, event.shiftKey), current.handle);
  };
  const move = (event: PointerEvent) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointer) return;
    if (event.pointerType === 'mouse' && !(event.buttons & 1)) {
      finish(event, true);
      return;
    }
    event.stopPropagation();
    const { x, y } = displacement(event, current);
    current.moved ||= Math.abs(x) + Math.abs(y) > 4;
    if (current.moved) setMoving(movedMark(current, x, y, event.shiftKey));
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
    onPointerDown: (event: ReactPointerEvent<SVGElement | HTMLButtonElement>) =>
      start(event, mark, handle),
    onKeyDown: (event: KeyboardEvent) => keys(event, mark, handle),
  });
  const area = (mark: BoardMark) =>
    mark.kind === 'label' || mark.kind === 'line'
      ? 0
      : Math.abs((mark.end.x - mark.at.x) * (mark.end.y - mark.at.y));
  // Сортируем по сохранённому размеру: перестановка SVG-элемента прерывает захват указателя.
  const items = [...marks.items]
    .sort((a, b) => area(b) - area(a))
    .map((mark) =>
      moving?.id === mark.id
        ? moving
        : offset && group.includes(mark.id)
          ? moveMark(mark, 'body', offset.x, offset.y, false)
          : mark,
    );
  const sketches = items.filter((mark) => mark.kind !== 'label');
  const actionsDisabled = busy || marks.locked || !!marks.tool;
  const draft = marks.draft;
  const draftShape =
    draft && draft.kind !== 'label' ? sketches.find(({ id }) => id === draft.id) : undefined;
  useEffect(() => {
    if (!draftShape) return;
    const saveOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !captionEditor.current?.contains(event.target)) {
        marks.saveLabel();
      }
    };
    document.addEventListener('pointerdown', saveOutside, true);
    return () => document.removeEventListener('pointerdown', saveOutside, true);
  }, [draftShape, marks.saveLabel]);
  const trash = (mark: BoardMark, label: string) => (
    <IconButton
      className="canvas-trash"
      icon="trash"
      iconSize={22.5}
      label={label}
      disabled={actionsDisabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => marks.remove(mark.id)}
    />
  );
  return (
    <>
      <svg className="mark-lines" width="1" height="1" aria-label="Разметка полотна">
        {sketches.map((mark) => {
          const selected = marks.selected === mark.id || moving?.id === mark.id;
          const grouped = group.includes(mark.id);
          const handles = mark.kind === 'line' ? (['at', 'end'] as const) : corners;
          return (
            <g
              key={mark.id}
              data-kind={mark.kind}
              data-active={selected || undefined}
              data-menu-mark={mark.id}
            >
              <MarkStroke
                sketch={mark}
                className={`mark-stroke ${mark.kind === 'line' ? '' : 'mark-fill'} ${grouped ? 'mark-grouped' : ''}`}
                data-mark-id={mark.id}
              />
              {mark.kind === 'line' && (
                <MarkStroke sketch={mark} className="canvas-controls-range" />
              )}
              <MarkStroke
                sketch={mark}
                className="mark-hit"
                role="button"
                tabIndex={0}
                aria-label={
                  mark.text ? `${sketchNames[mark.kind]}: ${mark.text}` : sketchNames[mark.kind]
                }
                aria-pressed={selected || grouped}
                {...pointer(mark)}
                onDoubleClick={() => {
                  if (mark.kind !== 'line' && !actionsDisabled) marks.choose(mark);
                }}
              />
              {mark.kind === 'line' ? (
                <foreignObject
                  className="mark-trash"
                  width={27}
                  height={27}
                  x={(mark.at.x + mark.end.x) / 2 - 13.5}
                  y={(mark.at.y + mark.end.y) / 2 - 30}
                >
                  {trash(mark, sketchTrash.line)}
                </foreignObject>
              ) : (
                marks.draft?.id !== mark.id && (
                  <ShapeCaption
                    sketch={mark}
                    disabled={actionsDisabled}
                    onEdit={() => marks.choose(mark)}
                  >
                    {trash(mark, sketchTrash[mark.kind])}
                  </ShapeCaption>
                )
              )}
              {handles.map((handle) => {
                const point = isCorner(handle) ? shapeCorner(mark, handle) : mark[handle];
                const name = isCorner(handle)
                  ? `${cornerNames[handle]} ${mark.kind === 'circle' ? 'круга' : 'прямоугольника'}`
                  : handle === 'at'
                    ? 'Начало линии разметки'
                    : 'Конец линии разметки';
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
              className={`canvas-label-item ${group.includes(mark.id) ? 'mark-grouped' : ''}`}
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
      {draft && (
        <form
          ref={captionEditor}
          className={`canvas-label-editor ${draftShape ? 'shape-caption-editor' : ''}`}
          style={{
            left: draft.at.x,
            top: draft.at.y,
            ...labelStyle(draft.scale),
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            marks.saveLabel();
          }}
        >
          {draftShape ? (
            <div className="shape-caption-draft" style={{ width: shapeCaptionWidth(draftShape) }}>
              <span className="shape-caption-mirror" aria-hidden="true">
                {draft.text + '\u200b'}
              </span>
              <textarea
                key={draft.id}
                autoFocus
                rows={1}
                aria-label="Подпись фигуры"
                maxLength={128}
                value={draft.text}
                readOnly={busy || marks.locked}
                onFocus={({ currentTarget }) =>
                  currentTarget.setSelectionRange(draft.text.length, draft.text.length)
                }
                onChange={(event) => marks.setText(event.target.value)}
                onBlur={marks.saveLabel}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing)
                    return;
                  event.preventDefault();
                  marks.saveLabel();
                }}
              />
            </div>
          ) : (
            <input
              key={draft.id}
              autoFocus
              className="canvas-label"
              aria-label="Текст подписи"
              maxLength={128}
              value={draft.text}
              readOnly={busy || marks.locked}
              style={{
                width: `clamp(calc(150px * var(--label-scale)), ${draft.text.length + 1}ch, calc(380px * var(--label-scale)))`,
              }}
              onChange={(event) => marks.setText(event.target.value)}
            />
          )}
        </form>
      )}
    </>
  );
}
