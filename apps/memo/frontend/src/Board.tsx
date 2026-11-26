import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from './api';
import { BoardContextMenu } from './BoardContextMenu';
import type { BoardMenuItem } from './BoardContextMenu';
import { MarkLayer, MarkTools, useCanvasMarks } from './CanvasMarks';
import { LinkControl } from './LinkControl';
import { Icon, IconButton } from './ui';
import { canConnect, cardDimensions, clampCardSize, excerpt } from './graph';
import { isTextInput, markTools } from './shortcuts';
import { readLocal, writeLocal } from './storage';
import { TrashDialog } from './TrashDialog';
import type {
  BoardClipboard,
  BoardMark,
  BoardSelection,
  Card,
  CardLink,
  NewBoardMark,
} from './types';

interface Props {
  cards: Card[];
  links: CardLink[];
  projectId: number;
  folderId: number | null;
  markToolsSlot: HTMLElement | null;
  locate: (card: Card) => void;
  busy: boolean;
  keyboardDisabled: boolean;
  storageKey: string;
  focusId: number | null;
  clipboard: BoardClipboard | null;
  copy: (item: BoardClipboard) => void;
  pasteCard: (source: number, at: Card['coordinates']) => void;
  createBlock: (kind: 'record' | 'folder', at: Card['coordinates']) => void;
  open: (card: Card, editing?: boolean) => void;
  enter: (card: Card) => void;
  moveInto: (card: Card, folder: Card) => Promise<void>;
  remove: (card: Card) => Promise<void>;
  removeSelection: (selection: BoardSelection, requestId: string) => Promise<void>;
  child: (card: Card) => void;
  position: (card: Card) => Promise<void>;
  connect: (source: number, target: number, label?: string) => Promise<void>;
  disconnect: (link: CardLink) => Promise<void>;
  reconnect: (link: CardLink, source: number, target: number) => Promise<void>;
}
interface Camera {
  scale: number;
  x: number;
  y: number;
}
const defaultScale = 0.5;
const minScale = 0.1;
const maxScale = 2;
const zoomStep = 0.05;

const resizeEdges = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;
type Edge = (typeof resizeEdges)[number];
type Bounds = { size: NonNullable<Card['size']>; coordinates: Card['coordinates'] };
type ResizeGesture = {
  card: Card;
  edge: Edge;
  x: number;
  y: number;
  pointer: number;
  scale: number;
};
interface Drag {
  card: Card | null;
  selecting: boolean;
  pointer: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}
const emptySelection: BoardSelection = { cards: [], marks: [] };
type MenuTarget = { card: Card } | { mark: BoardMark } | null;
type MenuPosition = { clientX: number; clientY: number };
const coordinateLimit = 100000;

function markAt(mark: NewBoardMark, point: Card['coordinates']): NewBoardMark {
  if (mark.kind === 'label') return { ...mark, at: point };
  const dx = mark.end.x - mark.at.x;
  const dy = mark.end.y - mark.at.y;
  const start = (at: number, delta: number) =>
    Math.max(
      -coordinateLimit - Math.min(0, delta),
      Math.min(coordinateLimit - Math.max(0, delta), at),
    );
  const at = { x: start(point.x, dx), y: start(point.y, dy) };
  return { kind: mark.kind, at, end: { x: at.x + dx, y: at.y + dy } };
}

function dragRectangle(drag: Drag, event: PointerEvent<HTMLElement>, board: DOMRect) {
  const x = Math.max(board.left, Math.min(board.right, event.clientX));
  const y = Math.max(board.top, Math.min(board.bottom, event.clientY));
  return new DOMRect(
    Math.min(drag.x, x),
    Math.min(drag.y, y),
    Math.abs(x - drag.x),
    Math.abs(y - drag.y),
  );
}

function CardPreview({ text }: { text: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(1);
  useLayoutEffect(() => {
    const element = frame.current;
    const paragraph = element?.firstElementChild;
    if (!element || !paragraph) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
      setLines(Math.floor(element.clientHeight / lineHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="card-preview" ref={frame}>
      <p
        className="card-excerpt"
        style={{
          WebkitLineClamp: Math.max(1, lines),
          visibility: lines > 0 ? undefined : 'hidden',
        }}
      >
        {text}
      </p>
    </div>
  );
}
function cameraValue(value: unknown): value is Camera {
  return (
    typeof value === 'object' &&
    value !== null &&
    'scale' in value &&
    typeof value.scale === 'number' &&
    Number.isFinite(value.scale) &&
    value.scale >= minScale &&
    value.scale <= maxScale &&
    'x' in value &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    'y' in value &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  );
}

interface References {
  ids: number[];
  positions: Record<string, Card['coordinates']>;
}
function referenceView(value: unknown): References {
  const result: References = { ids: [], positions: {} };
  if (
    typeof value !== 'object' ||
    value === null ||
    !('ids' in value) ||
    !Array.isArray(value.ids) ||
    !('positions' in value) ||
    typeof value.positions !== 'object' ||
    value.positions === null
  )
    return result;
  result.ids = value.ids.filter(
    (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
  );
  const entries: [string, unknown][] = Object.entries(value.positions);
  for (const [id, point] of entries) {
    if (!/^[1-9]\d*$/.test(id)) continue;
    if (
      typeof point === 'object' &&
      point !== null &&
      'x' in point &&
      typeof point.x === 'number' &&
      Number.isFinite(point.x) &&
      'y' in point &&
      typeof point.y === 'number' &&
      Number.isFinite(point.y)
    )
      result.positions[id] = { x: point.x, y: point.y };
  }
  return result;
}

export function Board({
  cards,
  links,
  projectId,
  folderId,
  markToolsSlot,
  locate,
  busy,
  keyboardDisabled,
  storageKey,
  focusId,
  clipboard,
  copy,
  pasteCard,
  createBlock,
  open,
  enter,
  moveInto,
  remove,
  removeSelection,
  child,
  position,
  connect,
  disconnect,
  reconnect,
}: Props) {
  const cached = readLocal(storageKey);
  const [camera, setCamera] = useState<Camera>(() =>
    cameraValue(cached) ? cached : { scale: defaultScale, x: 40, y: 60 },
  );
  const [temporary, setTemporary] = useState<Record<number, Card['coordinates']>>({});
  const [resizePreview, setResizePreview] = useState<(Bounds & { id: number }) | null>(null);
  const [dropFolder, setDropFolder] = useState<number | null>(null);
  const [trashCandidate, setTrashCandidate] = useState<Card | null>(null);
  const [marquee, setMarquee] = useState<DOMRect | null>(null);
  const [group, setGroup] = useState<BoardSelection>(emptySelection);
  const [trashGroup, setTrashGroup] = useState<{
    selection: BoardSelection;
    requestId: string;
  } | null>(null);
  const [trashError, setTrashError] = useState('');
  const [source, setSource] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Card['coordinates'] | null>(null);
  const [references, setReferences] = useState<References>(() =>
    referenceView(readLocal(`${storageKey}:references`)),
  );
  const [external, setExternal] = useState<Card[]>([]);
  const [referenceError, setReferenceError] = useState('');
  const [referenceRevision, setReferenceRevision] = useState(0);
  const [reconnecting, setReconnecting] = useState<{
    link: CardLink;
    moving: 'source' | 'target';
  } | null>(null);
  const [selectedId, setSelectedId] = useState(focusId);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [contextMenu, setContextMenu] = useState<
    | (MenuPosition & {
        target: MenuTarget;
        returnFocus: HTMLElement | SVGElement;
      })
    | null
  >(null);
  const root = useRef<HTMLElement>(null);
  const viewport = useRef<{ width: number; height: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const markPointer = useRef<number | null>(null);
  const resizing = useRef<ResizeGesture | null>(null);
  const linking = useRef(false);
  const linkPress = useRef<{
    x: number;
    y: number;
    pointer: number;
    moved: boolean;
    child?: Card;
  } | null>(null);
  const suppressLinkClick = useRef(false);
  const linkFocus = useRef<HTMLElement | SVGElement | null>(null);
  const marks = useCanvasMarks(projectId, folderId);
  const onThisBoard = (card: Card) =>
    card.project === projectId && (card.folder ?? null) === folderId;
  const selectCard = (card: Card) => {
    marks.cancel();
    setGroup(emptySelection);
    if (card.kind === 'folder') enter(card);
    else {
      setSelectedId(card.id);
      open(card);
    }
  };
  const point = (card: Card) =>
    resizePreview?.id === card.id
      ? resizePreview.coordinates
      : (temporary[card.id] ?? card.coordinates);
  const size = (card: Card) =>
    resizePreview?.id === card.id ? resizePreview.size : cardDimensions(card);
  const port = (card: Card, output = false) => {
    const { x, y } = point(card);
    const { width, height } = size(card);
    return { x: x + width / 2, y: y + (output ? height : 0) };
  };
  const automaticReferences = links
    .filter((link) => cards.some((card) => card.id === link.source || card.id === link.target))
    .flatMap((link) => [link.source, link.target])
    .filter((id) => !cards.some((card) => card.id === id));
  const neededReferences = [...new Set([...references.ids, ...automaticReferences])].filter(
    (id) => !cards.some((card) => card.id === id),
  );
  const referenceKey = neededReferences
    .slice()
    .sort((a, b) => a - b)
    .join(',');
  const allCards = [
    ...cards,
    ...external
      .filter((card) => neededReferences.includes(card.id))
      .map((card, index) => ({
        ...card,
        coordinates: references.positions[String(card.id)] ?? {
          x:
            Math.max(320, ...cards.map((item) => item.coordinates.x + size(item).width)) +
            80 +
            index * 280,
          y: 80,
        },
      })),
  ];
  const visible = allCards;
  useEffect(() => {
    writeLocal(`${storageKey}:references`, references);
  }, [references, storageKey]);
  useEffect(() => {
    let live = true;
    if (!neededReferences.length) {
      setExternal([]);
      setReferenceError('');
      return;
    }
    const requested =
      referenceRevision > 0
        ? neededReferences
        : neededReferences.filter((id) => !external.some((card) => card.id === id));
    if (!requested.length) {
      setReferenceError('');
      return;
    }
    void Promise.allSettled(requested.map((id) => api.card(id))).then((results) => {
      if (!live) return;
      setExternal((current) => {
        const available = new Map(current.map((card) => [card.id, card]));
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') available.set(result.value.id, result.value);
          else if (result.reason instanceof ApiError && result.reason.status === 404)
            available.delete(requested[index]);
        });
        return [...available.values()].filter((card) => neededReferences.includes(card.id));
      });
      setReferenceError(
        results.some((result) => result.status === 'rejected')
          ? 'Некоторые записи с других полотен недоступны. Повторите загрузку.'
          : '',
      );
    });
    return () => {
      live = false;
    };
  }, [referenceKey, referenceRevision]);
  const localLinks = links.filter(
    (link) =>
      visible.some((card) => card.id === link.source) &&
      visible.some((card) => card.id === link.target),
  );
  const selection = visible.some((card) => card.id === selectedId) ? selectedId : null;
  const related = (link: CardLink) => link.source === selection || link.target === selection;
  const neighbors = new Set(
    localLinks.filter(related).flatMap((link) => [link.source, link.target]),
  );
  const fit = (items = visible) => {
    if (!root.current || !items.length) return;
    const left = Math.min(...items.map((card) => point(card).x));
    const top = Math.min(...items.map((card) => point(card).y));
    const right = Math.max(...items.map((card) => point(card).x + size(card).width));
    const bottom = Math.max(...items.map((card) => point(card).y + size(card).height));
    const width = root.current.clientWidth;
    const height = root.current.clientHeight;
    const scale = Math.max(
      minScale,
      Math.min(defaultScale, (width - 80) / (right - left), (height - 150) / (bottom - top)),
    );
    setCamera({
      scale,
      x: (width - (right - left) * scale) / 2 - left * scale,
      y: (height - (bottom - top) * scale) / 2 - top * scale,
    });
  };
  useEffect(() => {
    writeLocal(storageKey, camera);
  }, [camera, storageKey]);
  useEffect(() => {
    if (!cameraValue(cached)) fit(allCards);
    // Полотно монтируется отдельно для каждого проекта.
  }, []);
  useEffect(() => {
    if (focusId !== null) {
      const card = allCards.find((item) => item.id === focusId);
      const board = root.current;
      if (card && board) {
        setSelectedId(card.id);
        setCamera((current) => {
          const { x, y } = card.coordinates;
          const { width, height } = cardDimensions(card);
          const left = x * current.scale + current.x;
          const top = y * current.scale + current.y;
          if (
            left >= 16 &&
            top >= 16 &&
            left + width * current.scale <= board.clientWidth - 16 &&
            top + height * current.scale <= board.clientHeight - 16
          )
            return current;
          return {
            ...current,
            x: board.clientWidth / 2 - (x + width / 2) * current.scale,
            y: board.clientHeight / 2 - (y + height / 2) * current.scale,
          };
        });
      }
    }
  }, [focusId]);
  useEffect(() => {
    const board = root.current;
    if (!board) return;
    const observer = new ResizeObserver(() => {
      const width = board.clientWidth;
      const height = board.clientHeight;
      const before = viewport.current;
      viewport.current = { width, height };
      if (!before || (before.width === width && before.height === height)) return;
      setCamera((current) => {
        const x = current.x + (width - before.width) / 2;
        const y = current.y + (height - before.height) / 2;
        const card = cards.find((item) => item.id === selectedId);
        if (!card) return { ...current, x, y };
        const bounds = cardDimensions(card);
        const cx = (card.coordinates.x + bounds.width / 2) * current.scale + x;
        const cy = (card.coordinates.y + bounds.height / 2) * current.scale + y;
        const inset = (center: number, span: number, extent: number) => {
          const margin = Math.min(span / 2, (extent * current.scale) / 2 + 12);
          return Math.max(margin, Math.min(span - margin, center)) - center;
        };
        return {
          ...current,
          x: x + inset(cx, width, bounds.width),
          y: y + inset(cy, height, bounds.height),
        };
      });
    });
    observer.observe(board);
    return () => observer.disconnect();
  }, [cards, selectedId]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (busy) return;
      event.preventDefault();
      setCamera((current) => {
        if (!event.ctrlKey && !event.metaKey)
          return { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY };
        const rect = element.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const scale = Math.max(
          minScale,
          Math.min(maxScale, current.scale * Math.exp(-event.deltaY * 0.01)),
        );
        return {
          scale,
          x: x - ((x - current.x) * scale) / current.scale,
          y: y - ((y - current.y) * scale) / current.scale,
        };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [busy]);
  const cancelLink = () => {
    setSource(null);
    setTarget(null);
    setCursor(null);
    linking.current = false;
    linkPress.current = null;
    setReconnecting(null);
  };
  const worldPoint = (event: MenuPosition) => {
    const rect = root.current?.getBoundingClientRect();
    const clamp = (value: number) => Math.max(-coordinateLimit, Math.min(coordinateLimit, value));
    return {
      x: clamp((event.clientX - (rect?.left ?? 0) - camera.x) / camera.scale),
      y: clamp((event.clientY - (rect?.top ?? 0) - camera.y) / camera.scale),
    };
  };
  const pair = (anchor: number, candidate: number) =>
    reconnecting?.moving === 'source'
      ? ([candidate, anchor] as const)
      : ([anchor, candidate] as const);
  const validTarget = (anchor: number, candidate: number) => {
    const [from, to] = pair(anchor, candidate);
    const available = reconnecting
      ? links.filter(
          (link) =>
            link.source !== reconnecting.link.source || link.target !== reconnecting.link.target,
        )
      : links;
    return (
      from !== to &&
      !available.some((link) => link.source === from && link.target === to) &&
      canConnect(available, from, to)
    );
  };
  const confirmGroup = (selection: BoardSelection) => {
    setTrashError('');
    setTrashGroup({ selection, requestId: crypto.randomUUID() });
  };
  const armMark = (tool: NonNullable<typeof marks.tool>) => {
    cancelLink();
    setGroup(emptySelection);
    marks.arm(tool);
  };
  const dismissMenu = () => {
    const trigger = contextMenu?.returnFocus;
    if (trigger && document.activeElement?.closest('.board-context-menu')) trigger.focus();
    setContextMenu(null);
  };
  const showMenu = (element: Element, position: MenuPosition) => {
    const board = root.current;
    if (!board || busy || trashCandidate || trashGroup) return false;
    if (
      element.closest(
        'input,textarea,select,[contenteditable],.board-tools,.mark-error,.zoom-controls,.connection-control,.link-hit',
      )
    )
      return false;
    const cardId = Number(element.closest('[data-card-id]')?.getAttribute('data-card-id'));
    const markId = Number(element.closest('[data-menu-mark]')?.getAttribute('data-menu-mark'));
    const card = visible.find((item) => item.id === cardId);
    const mark = marks.items.find((item) => item.id === markId);
    const focus = element.closest('button,[tabindex]');
    const returnFocus = focus instanceof HTMLElement || focus instanceof SVGElement ? focus : board;
    setContextMenu({ ...position, target: card ? { card } : mark ? { mark } : null, returnFocus });
    return true;
  };
  const menuItems = (menu: MenuPosition & { target: MenuTarget }): BoardMenuItem[] => {
    const { target } = menu;
    if (target && 'card' in target) {
      const card = target.card;
      return [
        {
          label: 'Редактировать',
          icon: 'pencil',
          action: () => {
            cancelLink();
            marks.cancel();
            setGroup(emptySelection);
            setSelectedId(card.id);
            open(card, true);
          },
        },
        { label: 'Копировать', icon: 'copy', action: () => copy({ cardId: card.id }) },
        {
          label: 'Удалить',
          icon: 'trash',
          danger: true,
          action: () => setTrashCandidate(card),
        },
      ];
    }
    if (target && 'mark' in target) {
      const { id, ...mark } = target.mark;
      return [
        {
          label: 'Редактировать',
          icon: 'pencil',
          disabled: marks.locked,
          action: () => {
            cancelLink();
            marks.cancel();
            setGroup(emptySelection);
            setSelectedId(null);
            marks.choose(target.mark);
          },
        },
        { label: 'Копировать', icon: 'copy', action: () => copy({ mark }) },
        {
          label: 'Удалить',
          icon: 'trash',
          danger: true,
          disabled: marks.locked,
          action: () => confirmGroup({ cards: [], marks: [id] }),
        },
      ];
    }
    const at = worldPoint(menu);
    return [
      {
        label: 'Вставить',
        icon: 'paste',
        disabled: !clipboard || ('mark' in clipboard && marks.locked),
        action: () => {
          if (!clipboard) return;
          if ('cardId' in clipboard) pasteCard(clipboard.cardId, at);
          else void marks.store(markAt(clipboard.mark, at));
        },
      },
      { label: 'Создать запись', icon: 'record', action: () => createBlock('record', at) },
      { label: 'Создать папку', icon: 'folder', action: () => createBlock('folder', at) },
      ...markTools.map(({ kind, icon, label }) => ({
        label,
        icon,
        disabled: marks.locked,
        action: () => {
          if (kind === 'label') {
            cancelLink();
            marks.cancel();
            setGroup(emptySelection);
            marks.placeLabel(at);
          } else armMark(kind);
        },
      })),
    ];
  };
  const finishLink = async (anchor: number, candidate: number) => {
    if (!validTarget(anchor, candidate)) {
      setNotice('Связь уже существует или создаёт цикл.');
      cancelLink();
      return;
    }
    const operation = reconnecting;
    const [from, to] = pair(anchor, candidate);
    cancelLink();
    try {
      if (operation) await reconnect(operation.link, from, to);
      else await connect(from, to);
      setNotice(operation ? 'Связь переназначена.' : 'Связь сохранена.');
    } catch {
      setNotice('Связь не подтверждена. Проверьте сообщение и повторите.');
    }
  };
  const selectReconnection = (link: CardLink, moving: 'source' | 'target') => {
    cancelLink();
    marks.cancel();
    setGroup(emptySelection);
    setReconnecting({ link, moving });
    setSource(moving === 'source' ? link.target : link.source);
  };
  const captureLink = (event: PointerEvent<HTMLElement | SVGElement>, child?: Card) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    linkFocus.current = event.currentTarget;
    suppressLinkClick.current = false;
    linkPress.current = {
      x: event.clientX,
      y: event.clientY,
      pointer: event.pointerId,
      moved: false,
      child,
    };
    linking.current = true;
  };
  const startReconnection = (
    event: PointerEvent<SVGLineElement>,
    link: CardLink,
    start: Card['coordinates'],
    end: Card['coordinates'],
  ) => {
    event.stopPropagation();
    if (busy || source !== null || marks.tool || event.button !== 0) return;
    const point = worldPoint(event);
    const fromStart = Math.hypot(point.x - start.x, point.y - start.y);
    const fromEnd = Math.hypot(point.x - end.x, point.y - end.y);
    selectReconnection(link, fromStart < fromEnd ? 'source' : 'target');
    captureLink(event);
  };
  const usePlus = (card: Card) => (onThisBoard(card) ? child(card) : locate(card));
  const start = (event: PointerEvent<HTMLElement>, card: Card | null, pan = false) => {
    if (
      busy ||
      source !== null ||
      drag.current ||
      resizing.current ||
      (!pan && event.button !== 0) ||
      (!pan &&
        event.target instanceof Element &&
        event.target.closest('button:not(.card-title),select,input'))
    )
      return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!pan && marks.tool) {
      setSelectedId(null);
      if (marks.tool !== 'label') markPointer.current = event.pointerId;
      marks.start(worldPoint(event));
      return;
    }
    const selecting = !card && !pan && event.pointerType !== 'touch';
    if (!card) event.preventDefault();
    if (selecting) {
      setSelectedId(null);
      setGroup(emptySelection);
      marks.cancel();
    }
    const origin = card ? point(card) : { x: camera.x, y: camera.y };
    drag.current = {
      card,
      selecting,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: origin.x,
      startY: origin.y,
      moved: false,
    };
  };
  const resized = (event: PointerEvent<HTMLElement>, current: ResizeGesture): Bounds => {
    const { width, height } = cardDimensions(current.card);
    const left = current.edge.includes('left');
    const top = current.edge.includes('top');
    const horizontal = left ? -1 : current.edge.includes('right') ? 1 : 0;
    const vertical = top ? -1 : current.edge.includes('bottom') ? 1 : 0;
    const next = clampCardSize(
      width + (horizontal * (event.clientX - current.x)) / current.scale,
      height + (vertical * (event.clientY - current.y)) / current.scale,
    );
    return {
      size: next,
      coordinates: {
        x: current.card.coordinates.x + (left ? width - next.width : 0),
        y: current.card.coordinates.y + (top ? height - next.height : 0),
      },
    };
  };
  const saveSize = async (card: Card, next: Bounds) => {
    const original = cardDimensions(card);
    if (original.width === next.size.width && original.height === next.size.height) return;
    setResizePreview({ id: card.id, ...next });
    try {
      await position({ ...card, ...next });
    } catch {
      setNotice('Не удалось сохранить размер карточки.');
    } finally {
      setResizePreview(null);
    }
  };
  const findDropFolder = (event: PointerEvent<HTMLElement>, dragged: Card) => {
    const rect = root.current?.getBoundingClientRect();
    if (
      !rect ||
      !onThisBoard(dragged) ||
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return;
    const cursor = worldPoint(event);
    return cards
      .slice()
      .reverse()
      .find((candidate) => {
        if (candidate.id === dragged.id || candidate.kind !== 'folder') return false;
        const { x, y } = point(candidate);
        const { width, height } = size(candidate);
        return cursor.x >= x && cursor.x <= x + width && cursor.y >= y && cursor.y <= y + height;
      });
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (resizing.current) {
      if (event.pointerId === resizing.current.pointer)
        setResizePreview({ id: resizing.current.card.id, ...resized(event, resizing.current) });
      return;
    }
    if (marks.tool && marks.tool !== 'label' && marks.move(worldPoint(event), event.shiftKey))
      return;
    if (linking.current && source !== null && root.current) {
      const press = linkPress.current;
      if (press && press.pointer !== event.pointerId) return;
      if (press && !press.moved) {
        if (Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) <= 5) return;
        press.moved = true;
        suppressLinkClick.current = true;
      }
      const rect = root.current.getBoundingClientRect();
      setCursor({
        x: (event.clientX - rect.left - camera.x) / camera.scale,
        y: (event.clientY - rect.top - camera.y) / camera.scale,
      });
      const element = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-card-id]');
      setTarget(element ? Number(element.dataset.cardId) : null);
      return;
    }
    const current = drag.current;
    if (!current || busy || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    current.moved ||= Math.abs(dx) + Math.abs(dy) > 5;
    if (!current.moved) return;
    if (current.selecting && root.current) {
      const board = root.current.getBoundingClientRect();
      const box = dragRectangle(current, event, board);
      setMarquee(new DOMRect(box.x - board.x, box.y - board.y, box.width, box.height));
    } else if (current.card) {
      const id = current.card.id;
      setDropFolder(findDropFolder(event, current.card)?.id ?? null);
      setTemporary((values) => ({
        ...values,
        [id]: { x: current.startX + dx / camera.scale, y: current.startY + dy / camera.scale },
      }));
    } else setCamera((value) => ({ ...value, x: current.startX + dx, y: current.startY + dy }));
  };
  const end = async (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const resize = resizing.current;
    if (resize) {
      if (resize.pointer !== event.pointerId) return;
      resizing.current = null;
      setResizePreview(null);
      if (!cancelled) await saveSize(resize.card, resized(event, resize));
      return;
    }
    if (markPointer.current === event.pointerId) {
      markPointer.current = null;
      marks.move(worldPoint(event), event.shiftKey);
      marks.finish(cancelled);
      return;
    }
    if (linking.current && source !== null) {
      const press = linkPress.current;
      if (press && press.pointer !== event.pointerId) return;
      if (press && !press.moved) {
        cancelLink();
        if (!cancelled && press.child) usePlus(press.child);
        return;
      }
      const element = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-card-id]');
      const destination = element ? Number(element.dataset.cardId) : null;
      if (!cancelled && destination !== null) await finishLink(source, destination);
      else {
        cancelLink();
        setNotice(cancelled ? 'Создание связи отменено.' : 'Отпустите связь на другой карточке.');
      }
      return;
    }
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    setDropFolder(null);
    if (current.selecting) {
      setMarquee(null);
      const board = root.current;
      if (cancelled || !board) return;
      const box = dragRectangle(current, event, board.getBoundingClientRect());
      const covered = (selector: string, id: string) =>
        [...board.querySelectorAll<HTMLElement | SVGElement>(selector)].flatMap((element) => {
          const rect = element.getBoundingClientRect();
          return box.left <= rect.left &&
            box.right >= rect.right &&
            box.top <= rect.top &&
            box.bottom >= rect.bottom
            ? [Number(element.getAttribute(id))]
            : [];
        });
      setGroup(
        current.moved
          ? {
              cards: covered('.mind-card:not(.reference-card)', 'data-card-id'),
              marks: covered(
                '.mark-stroke[data-mark-id], .canvas-label-item[data-mark-id]',
                'data-mark-id',
              ),
            }
          : emptySelection,
      );
      return;
    }
    if (!current?.card) {
      if (current && !current.moved && !cancelled) {
        marks.cancel();
        setSelectedId(null);
        setGroup(emptySelection);
      }
      return;
    }
    const card = current.card;
    if (current.moved && !cancelled) {
      try {
        const folder = findDropFolder(event, card);
        const coordinates = {
          x: current.startX + (event.clientX - current.x) / camera.scale,
          y: current.startY + (event.clientY - current.y) / camera.scale,
        };
        if (folder) {
          await moveInto(card, folder);
          setNotice(`«${card.name}» перемещена в «${folder.name}».`);
        } else if (onThisBoard(card)) await position({ ...card, coordinates });
        else
          setReferences((value) => ({
            ...value,
            positions: { ...value.positions, [card.id]: coordinates },
          }));
      } catch {
        /* Ошибка показана приложением, положение откатывается. */
      }
    } else if (!cancelled) {
      selectCard(card);
    }
    setTemporary((values) => {
      const next = { ...values };
      delete next[card.id];
      return next;
    });
  };
  const trashFromCanvas = async (card: Card) => {
    await remove(card);
    const positions = { ...references.positions };
    delete positions[String(card.id)];
    const next = { ids: references.ids.filter((id) => id !== card.id), positions };
    writeLocal(`${storageKey}:references`, next);
    setReferences(next);
    setExternal((items) => items.filter((item) => item.id !== card.id));
  };
  const zoom = (scale: number) => {
    const element = root.current;
    if (!element) return;
    setCamera((current) => ({
      scale,
      x: element.clientWidth / 2 - ((element.clientWidth / 2 - current.x) * scale) / current.scale,
      y:
        element.clientHeight / 2 - ((element.clientHeight / 2 - current.y) * scale) / current.scale,
    }));
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        busy ||
        keyboardDisabled ||
        trashCandidate ||
        trashGroup ||
        event.defaultPrevented ||
        event.isComposing ||
        (event.target instanceof Element && !!event.target.closest('dialog[open]'))
      )
        return;
      if (
        event.key === 'Escape' &&
        (source !== null ||
          marks.tool ||
          marks.draft ||
          marks.selected !== null ||
          group.cards.length ||
          group.marks.length)
      ) {
        event.preventDefault();
        cancelLink();
        marks.cancel();
        setGroup(emptySelection);
        linkFocus.current?.focus();
        setSelectedId(null);
        return;
      }
      if (isTextInput(event) || event.ctrlKey || event.metaKey) return;
      if (event.altKey && event.shiftKey && !event.repeat && !marks.locked) {
        const tool = markTools.find(({ key }) => event.code === `Key${key}`)?.kind;
        if (!tool) return;
        event.preventDefault();
        armMark(tool);
        return;
      }
      if (event.altKey || (source !== null && event.key !== 'Escape')) return;
      const card = visible.find((item) => item.id === selection);
      if (event.key === '+' || event.key === '-' || event.key === '−') {
        event.preventDefault();
        zoom(
          Math.max(
            minScale,
            Math.min(maxScale, camera.scale + (event.key === '+' ? zoomStep : -zoomStep)),
          ),
        );
      } else if (event.key === 'Escape') {
        setSelectedId(null);
      } else if (
        !event.repeat &&
        !event.shiftKey &&
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !marks.tool &&
        !marks.draft
      ) {
        event.preventDefault();
        if (group.cards.length || group.marks.length) confirmGroup(group);
        else if (marks.selected !== null) confirmGroup({ cards: [], marks: [marks.selected] });
        else if (card) setTrashCandidate(card);
      } else if (!event.repeat && !event.shiftKey && card && !marks.tool && !marks.draft) {
        if (event.code === 'KeyE') {
          event.preventDefault();
          open(card, true);
        } else if (event.code === 'KeyL') {
          event.preventDefault();
          cancelLink();
          setSource(card.id);
        }
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });
  const sourceCard = allCards.find((card) => card.id === source);
  const movingStart = reconnecting?.moving === 'source';
  const fixedPort = sourceCard ? port(sourceCard, !movingStart) : null;
  const worldStyle: CSSProperties & { '--board-scale': number } = {
    transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
    '--board-scale': camera.scale,
  };
  return (
    <section
      ref={root}
      className={`board ${marks.tool ? 'board-marking' : ''}`}
      aria-label="Полотно проекта"
      tabIndex={0}
      onContextMenu={(event) => {
        if (event.target instanceof Element && showMenu(event.target, event)) {
          event.preventDefault();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        if (!(event.target instanceof Element)) return;
        const rect = event.target.getBoundingClientRect();
        if (showMenu(event.target, { clientX: rect.left + 12, clientY: rect.top + 12 }))
          event.preventDefault();
      }}
      onPointerDownCapture={(event) => {
        if (
          event.button === 1 &&
          event.target instanceof Element &&
          event.target.closest('.board') === root.current
        ) {
          event.preventDefault();
          start(event, null, true);
        }
      }}
      onPointerDown={(event) => start(event, null)}
      onPointerMove={move}
      onPointerUp={(event) => void end(event)}
      onPointerCancel={(event) => void end(event, true)}
    >
      {contextMenu && (
        <BoardContextMenu
          x={contextMenu.clientX}
          y={contextMenu.clientY}
          label={contextMenu.target ? 'Действия элемента' : 'Инструменты полотна'}
          items={menuItems(contextMenu)}
          dismiss={dismissMenu}
        />
      )}
      {markToolsSlot &&
        createPortal(
          <MarkTools marks={marks} busy={busy || source !== null} arm={armMark} />,
          markToolsSlot,
        )}
      {marquee && (
        <div
          className="board-marquee"
          aria-hidden="true"
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.width,
            height: marquee.height,
          }}
        />
      )}
      {source !== null && (
        <div className="board-tools" onPointerDown={(event) => event.stopPropagation()}>
          <button className="secondary" onClick={cancelLink}>
            Отменить связь
          </button>
        </div>
      )}
      {marks.error && (
        <div className="mark-error" role="alert" onPointerDown={(event) => event.stopPropagation()}>
          {marks.error}{' '}
          <button className="text-button" onClick={marks.retry}>
            Повторить
          </button>
        </div>
      )}
      {referenceError && (
        <div
          className="canvas-reference-error"
          role="alert"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {referenceError}
          <button
            className="text-button"
            onClick={() => setReferenceRevision((value) => value + 1)}
          >
            Повторить
          </button>
        </div>
      )}
      {sourceCard && (
        <p className="board-hint has-tools" role="status">
          {target !== null
            ? validTarget(sourceCard.id, target)
              ? 'Отпустите, чтобы связать'
              : 'Недопустимая связь'
            : reconnecting
              ? 'Выберите карточку для нового конца связи'
              : `Связь от «${sourceCard.name}»`}
        </p>
      )}
      <div className="board-world" style={worldStyle}>
        <MarkLayer
          marks={marks}
          scale={camera.scale}
          busy={busy || source !== null}
          group={group.marks}
        />
        <svg className="connections" width="1" height="1" aria-hidden="true">
          {localLinks.map((link) => {
            const from = visible.find((card) => card.id === link.source);
            const to = visible.find((card) => card.id === link.target);
            if (!from || !to) return null;
            const a = port(from, true);
            const b = port(to);
            const key = `${link.source}:${link.target}`;
            const coords = {
              x1: a.x,
              y1: a.y,
              x2: b.x,
              y2: b.y,
            };
            const appearance =
              selection === null ? '' : related(link) ? 'related-link' : 'dimmed-link';
            return (
              <g key={key}>
                <line
                  {...coords}
                  className={`${appearance} ${reconnecting?.link.source === link.source && reconnecting.link.target === link.target ? 'reconnecting-link' : ''}`}
                />
                <line
                  {...coords}
                  className="link-hit"
                  onPointerDown={(event) => startReconnection(event, link, a, b)}
                  onPointerEnter={() => setHoveredLink(key)}
                  onPointerLeave={() => setHoveredLink(null)}
                  onClick={() => {
                    if (!suppressLinkClick.current) document.getElementById(`edge-${key}`)?.focus();
                  }}
                />
              </g>
            );
          })}
          {sourceCard && cursor && fixedPort && (
            <line
              className={`draft-link ${target !== null && !validTarget(sourceCard.id, target) ? 'invalid' : ''}`}
              x1={movingStart ? cursor.x : fixedPort.x}
              y1={movingStart ? cursor.y : fixedPort.y}
              x2={movingStart ? fixedPort.x : cursor.x}
              y2={movingStart ? fixedPort.y : cursor.y}
            />
          )}
        </svg>
        {localLinks.map((link) => {
          const from = visible.find((card) => card.id === link.source);
          const to = visible.find((card) => card.id === link.target);
          if (!from || !to) return null;
          const a = port(from, true);
          const b = port(to);
          return (
            <LinkControl
              key={`${link.source}:${link.target}`}
              link={link}
              highlighted={hoveredLink === `${link.source}:${link.target}`}
              dimmed={selection !== null && !related(link)}
              busy={busy}
              style={{
                left: (a.x + b.x) / 2,
                top: (a.y + b.y) / 2,
              }}
              save={(item, label) => connect(item.source, item.target, label)}
              remove={disconnect}
              reassign={(moving) => selectReconnection(link, moving)}
            />
          );
        })}
        {visible.map((card) => {
          const connected = source !== null && target === card.id;
          const local = onThisBoard(card);
          const isFolder = card.kind === 'folder';
          return (
            <article
              key={card.id}
              data-card-id={card.id}
              className={`mind-card ${local ? '' : 'reference-card'} ${connected ? (validTarget(source ?? card.id, card.id) ? 'valid-target' : 'invalid-target') : ''} ${selection === card.id || group.cards.includes(card.id) ? 'focused-card' : neighbors.has(card.id) ? 'related-card' : ''} ${isFolder ? 'folder-card' : ''} ${dropFolder === card.id ? 'folder-drop-target' : ''} ${temporary[card.id] ? 'dragging-card' : ''}`}
              style={{ left: point(card).x, top: point(card).y, ...size(card) }}
              onPointerDown={(event) => start(event, card)}
            >
              <button
                className="card-title"
                disabled={busy}
                aria-label={
                  source !== null
                    ? `Связать с ${card.name}`
                    : isFolder
                      ? `Открыть папку ${card.name}`
                      : undefined
                }
                aria-pressed={
                  !isFolder && source === null
                    ? selection === card.id || group.cards.includes(card.id)
                    : undefined
                }
                onFocus={() => {
                  if (source !== null) setTarget(card.id);
                }}
                onBlur={() => {
                  if (!linking.current) setTarget(null);
                }}
                onClick={(event) => {
                  if (source !== null && !linking.current) void finishLink(source, card.id);
                  else if (event.detail === 0) selectCard(card);
                }}
              >
                {isFolder && <Icon name="folder" />}
                <span>{card.name}</span>
              </button>
              <CardPreview text={isFolder ? 'Открыть полотно' : excerpt(card)} />
              <IconButton
                className="canvas-trash card-trash"
                icon="trash"
                label={`В корзину: ${card.name}`}
                disabled={busy}
                onClick={() => setTrashCandidate(card)}
              />
              {local &&
                !marks.tool &&
                source === null &&
                resizeEdges.map((edge) => {
                  const keyboard = edge === 'bottom-right';
                  return (
                    <span
                      key={edge}
                      className={`card-edge ${edge}`}
                      role={keyboard ? 'button' : undefined}
                      aria-label={keyboard ? `Изменить размер: ${card.name}` : undefined}
                      aria-disabled={keyboard ? busy : undefined}
                      tabIndex={keyboard && !busy ? 0 : undefined}
                      aria-keyshortcuts={
                        keyboard ? 'ArrowLeft ArrowRight ArrowUp ArrowDown' : undefined
                      }
                      onPointerDown={(event) => {
                        if (busy || event.button !== 0 || resizing.current) return;
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        resizing.current = {
                          card,
                          edge,
                          x: event.clientX,
                          y: event.clientY,
                          pointer: event.pointerId,
                          scale: camera.scale,
                        };
                      }}
                      onKeyDown={
                        keyboard
                          ? (event) => {
                              if (busy) return;
                              const dx =
                                event.key === 'ArrowRight'
                                  ? 16
                                  : event.key === 'ArrowLeft'
                                    ? -16
                                    : 0;
                              const dy =
                                event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0;
                              if (!dx && !dy) return;
                              event.preventDefault();
                              const { width, height } = size(card);
                              void saveSize(card, {
                                size: clampCardSize(width + dx, height + dy),
                                coordinates: card.coordinates,
                              });
                            }
                          : undefined
                      }
                    />
                  );
                })}
              <div className="card-actions" onPointerDown={(event) => event.stopPropagation()}>
                <IconButton
                  className="card-action link-output"
                  icon={local ? 'plus' : 'board'}
                  label={
                    local
                      ? `Добавить потомка к ${card.name}`
                      : `Открыть исходный проект ${card.name}`
                  }
                  tooltip={
                    local ? 'Клик — добавить потомка. Перетащите, чтобы создать связь.' : undefined
                  }
                  disabled={busy}
                  onPointerDown={(event) => {
                    if (busy || source !== null || event.button !== 0) return;
                    marks.cancel();
                    setGroup(emptySelection);
                    cancelLink();
                    setSource(card.id);
                    captureLink(event, card);
                  }}
                  onClick={(event) => {
                    if (event.detail === 0) usePlus(card);
                  }}
                />
              </div>
            </article>
          );
        })}
      </div>
      {!allCards.length && !marks.items.length && !marks.tool && !marks.draft && (
        <div className="board-empty">
          <span>✧</span>
          <h2>Здесь пока пусто</h2>
          <p>Добавьте запись или папку.</p>
        </div>
      )}
      <div className="zoom-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button
          aria-label="Уменьшить масштаб"
          onClick={() => zoom(Math.max(minScale, camera.scale - zoomStep))}
        >
          −
        </button>
        <input
          aria-label="Масштаб полотна"
          type="range"
          min={(minScale / defaultScale) * 100}
          max={(maxScale / defaultScale) * 100}
          step="1"
          value={Math.round((camera.scale / defaultScale) * 100)}
          aria-valuetext={`${Math.round((camera.scale / defaultScale) * 100)}%`}
          onChange={(event) => zoom((Number(event.target.value) * defaultScale) / 100)}
        />
        <button
          className="zoom-reset"
          aria-label="Сбросить масштаб до 100%"
          onClick={() => zoom(defaultScale)}
        >
          {Math.round((camera.scale / defaultScale) * 100)}%
        </button>
        <button
          aria-label="Увеличить масштаб"
          onClick={() => zoom(Math.min(maxScale, camera.scale + zoomStep))}
        >
          ＋
        </button>
      </div>
      <span className="sr-only" role="status">
        {group.cards.length || group.marks.length
          ? `Выделено элементов: ${group.cards.length + group.marks.length}`
          : notice}
      </span>
      {trashCandidate && (
        <TrashDialog
          card={trashCandidate}
          busy={busy}
          cancel={() => setTrashCandidate(null)}
          confirm={() =>
            void trashFromCanvas(trashCandidate)
              .catch(() => setNotice('Не удалось переместить элемент в корзину.'))
              .finally(() => setTrashCandidate(null))
          }
        />
      )}
      {trashGroup && (
        <TrashDialog
          selection={trashGroup.selection}
          error={trashError}
          busy={busy}
          cancel={() => setTrashGroup(null)}
          confirm={() =>
            void removeSelection(trashGroup.selection, trashGroup.requestId)
              .then(() => {
                setGroup(emptySelection);
                setTrashGroup(null);
              })
              .catch((reason: unknown) =>
                setTrashError(
                  reason instanceof Error
                    ? reason.message
                    : 'Не удалось удалить выбранные элементы.',
                ),
              )
          }
        />
      )}
    </section>
  );
}
