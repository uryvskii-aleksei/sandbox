import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { ApiError } from './api';
import { useWorkspaceClient } from './WorkspaceClient';
import { BoardContextMenu } from './BoardContextMenu';
import type { BoardMenuItem } from './BoardContextMenu';
import { MarkLayer, useCanvasMarks } from './CanvasMarks';
import { CardTitleEditor } from './CardTitleEditor';
import { linkPort, routeBoardLinks, routeConnection } from './connectionRoutes';
import { LinkControl } from './LinkControl';
import { IconButton, Toast } from './ui';
import { canConnect, cardDimensions, cardHeight, clampCardSize } from './graph';
import { isTextInput, markTools } from './shortcuts';
import { readLocal, writeLocal } from './storage';
import { TrashDialog } from './TrashDialog';
import type {
  BoardClipboard,
  BoardMark,
  BoardMove,
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
  drawingTool: (typeof markTools)[number]['kind'] | null;
  consumeDrawingTool: () => void;
  notifications: ReactNode;
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
  rename: (id: number, name: string, height?: number) => Promise<Card>;
  moveSelection: (cards: Card[], marks: number[], move: BoardMove) => Promise<BoardMark[]>;
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
const defaultScale = 0.65;
const previousDefaultScale = 0.5;
const minScale = 0.1;
const maxScale = 2;
const zoomStep = defaultScale / 10;

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
  title: boolean;
  selecting: boolean;
  selection: BoardSelection | null;
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
const isAutoHeight = (card: Card) => card.autoHeight ?? cardDimensions(card).height === cardHeight;
const coordinateLimit = 100000;
// Вертикальные отступы карточки вместе с рамкой и высота строки названия.
const cardVerticalInsets = 41;
const cardTitleLineHeight = 25.3;

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
  return { ...mark, at, end: { x: at.x + dx, y: at.y + dy } };
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
  drawingTool,
  consumeDrawingTool,
  notifications,
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
  rename,
  moveSelection,
  remove,
  removeSelection,
  child,
  position,
  connect,
  disconnect,
  reconnect,
}: Props) {
  const api = useWorkspaceClient();
  const [savedCamera] = useState(() => {
    const value = readLocal(storageKey);
    return cameraValue(value) ? value : null;
  });
  const [camera, setCamera] = useState<Camera>(
    savedCamera ?? { scale: defaultScale, x: 40, y: 60 },
  );
  const [temporary, setTemporary] = useState<Record<number, Card['coordinates']>>({});
  const [resizePreview, setResizePreview] = useState<(Bounds & { id: number }) | null>(null);
  const [dropFolder, setDropFolder] = useState<{ id: number; allowed: boolean } | null>(null);
  const [trashCandidate, setTrashCandidate] = useState<Card | null>(null);
  const [marquee, setMarquee] = useState<{ rect: DOMRect; selection: BoardSelection } | null>(null);
  const [groupOffset, setGroupOffset] = useState<Card['coordinates'] | null>(null);
  const [moveError, setMoveError] = useState('');
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
  const [titleCardId, setTitleCardId] = useState<number | null>(null);
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
  // Счётчик кликов учитываем только после отпускания мыши без перетаскивания.
  const mouseClick = useRef<{ id: number; title: boolean } | null>(null);
  const previousBodyClick = useRef<number | null>(null);
  const modifierSelectionHandled = useRef(false);
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
  const highlightCard = (id: number) => {
    marks.cancel();
    setGroup(emptySelection);
    setSelectedId(id);
  };
  const selectCard = (card: Card) => {
    highlightCard(card.id);
    if (card.kind === 'folder') enter(card);
    else open(card);
  };
  const saveTitle = async (id: number, name: string, height?: number) => {
    const renamed = await rename(id, name, height);
    setExternal((items) => items.map((item) => (item.id === id ? renamed : item)));
  };
  const point = (card: Card) =>
    resizePreview?.id === card.id
      ? resizePreview.coordinates
      : (temporary[card.id] ?? card.coordinates);
  const [autoHeights, setAutoHeights] = useState<Record<number, number>>({});
  const observer = useRef<ResizeObserver | null>(null);
  const observeCard = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const current = (observer.current ??= new ResizeObserver((entries) => {
      setAutoHeights((previous) => {
        const next = { ...previous };
        let changed = false;
        for (const entry of entries) {
          if (
            !(entry.target instanceof HTMLElement) ||
            !entry.target.hasAttribute('data-auto-height')
          )
            continue;
          const id = Number(entry.target.dataset.cardId);
          const height = entry.target.offsetHeight;
          if (height > 0 && height !== previous[id]) {
            next[id] = height;
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    }));
    current.observe(element, { box: 'border-box' });
    return () => current.unobserve(element);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  const displayedSize = (card: Card) => {
    const saved = cardDimensions(card);
    return isAutoHeight(card) ? { ...saved, height: autoHeights[card.id] ?? saved.height } : saved;
  };
  const size = (card: Card) =>
    resizePreview?.id === card.id ? resizePreview.size : displayedSize(card);
  const neededReferences = useMemo(() => {
    const localIds = new Set(cards.map((card) => card.id));
    const linked = links
      .filter((link) => localIds.has(link.source) || localIds.has(link.target))
      .flatMap((link) => [link.source, link.target]);
    return [...new Set([...references.ids, ...linked])].filter((id) => !localIds.has(id));
  }, [cards, links, references.ids]);
  const referenceKey = neededReferences
    .slice()
    .sort((a, b) => a - b)
    .join(',');
  const allCards = useMemo(
    () => [
      ...cards,
      ...external
        .filter((card) => neededReferences.includes(card.id))
        .map((card, index) => ({
          ...card,
          coordinates: references.positions[String(card.id)] ?? {
            x:
              Math.max(
                320,
                ...cards.map((item) => item.coordinates.x + cardDimensions(item).width),
              ) +
              80 +
              index * 280,
            y: 80,
          },
        })),
    ],
    [cards, external, neededReferences, references.positions],
  );
  const visible = allCards;
  const blocks = useMemo(
    () => visible.map((card) => ({ id: card.id, ...point(card), ...size(card) })),
    [visible, temporary, resizePreview, autoHeights],
  );
  const routedLinks = useMemo(() => routeBoardLinks(links, blocks), [links, blocks]);
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
  const selection = visible.some((card) => card.id === selectedId) ? selectedId : null;
  const related = (link: CardLink) => link.source === selection || link.target === selection;
  const neighbors = new Set(
    routedLinks.flatMap(({ link }) => (related(link) ? [link.source, link.target] : [])),
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
  const zoom = (requestedScale: number) => {
    const scale = Math.max(minScale, Math.min(maxScale, requestedScale));
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
    writeLocal(storageKey, { ...camera, defaultScale });
  }, [camera, storageKey]);
  useLayoutEffect(() => {
    if (!savedCamera) fit(allCards);
    else if (!('defaultScale' in savedCamera) && savedCamera.scale === previousDefaultScale)
      zoom(defaultScale);
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
  useEffect(() => {
    if (!drawingTool || busy || marks.locked) return;
    consumeDrawingTool();
    armMark(drawingTool);
  }, [drawingTool, busy, marks.locked]);
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
        ...(card.kind === 'folder'
          ? [{ label: 'Открыть', icon: 'folder' as const, action: () => selectCard(card) }]
          : []),
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
        ...(onThisBoard(card)
          ? [
              {
                label: 'Добавить связанную запись',
                icon: 'plus' as const,
                disabled: busy,
                action: () => usePlus(card),
              },
            ]
          : []),
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
      const hasCaption = mark.kind === 'square' || mark.kind === 'circle';
      return [
        {
          label: hasCaption
            ? mark.text
              ? 'Изменить подпись'
              : 'Добавить подпись'
            : 'Редактировать',
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
        action: () => armMark(kind),
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
    event: PointerEvent<SVGPathElement>,
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
  const start = (
    event: PointerEvent<HTMLElement>,
    card: Card | null,
    pan = false,
    moveGroup = false,
  ) => {
    if (
      busy ||
      source !== null ||
      drag.current ||
      resizing.current ||
      (!pan && event.button !== 0) ||
      (!pan &&
        !moveGroup &&
        event.target instanceof Element &&
        event.target.closest('button:not(.card-title),select,input,textarea'))
    )
      return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!pan && marks.tool) {
      setSelectedId(null);
      markPointer.current = event.pointerId;
      marks.start(worldPoint(event));
      return;
    }
    setMoveError('');
    const selection = moveGroup || (card && group.cards.includes(card.id)) ? group : null;
    const selecting = !card && !selection && !pan && event.pointerType !== 'touch';
    if (!card) event.preventDefault();
    if (selecting) {
      setSelectedId(null);
      setGroup(emptySelection);
      marks.cancel();
    }
    const origin = card ? point(card) : { x: camera.x, y: camera.y };
    drag.current = {
      card,
      title: !!card && event.target instanceof Element && !!event.target.closest('.card-title'),
      selecting,
      selection,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: origin.x,
      startY: origin.y,
      moved: false,
    };
  };
  const resized = (event: PointerEvent<HTMLElement>, current: ResizeGesture): Bounds => {
    const { width, height } = displayedSize(current.card);
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
    const original = displayedSize(card);
    if (original.width === next.size.width && original.height === next.size.height) return;
    setResizePreview({ id: card.id, ...next });
    try {
      await position({ ...card, ...next, autoHeight: false });
    } catch {
      setNotice('Не удалось сохранить размер карточки.');
    } finally {
      setResizePreview(null);
    }
  };
  const findDropFolder = (event: PointerEvent<HTMLElement>, moving: number[]) => {
    const rect = root.current?.getBoundingClientRect();
    if (
      !rect ||
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
        if (moving.includes(candidate.id) || candidate.kind !== 'folder') return false;
        const { x, y } = point(candidate);
        const { width, height } = size(candidate);
        return cursor.x >= x && cursor.x <= x + width && cursor.y >= y && cursor.y <= y + height;
      });
  };
  const linkedMoveError =
    'Для переноса в папку выделите всю группу связанных карточек на этом полотне.';
  const canMoveToFolder = (ids: number[]) => {
    const local = new Set(cards.map((card) => card.id));
    const moving = new Set(ids);
    return links.every(
      ({ source, target }) =>
        !local.has(source) || !local.has(target) || moving.has(source) === moving.has(target),
    );
  };
  const selectionIn = (box: DOMRect, board: HTMLElement): BoardSelection => {
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
    return {
      cards: covered('.mind-card:not(.reference-card)', 'data-card-id'),
      marks: covered(
        '.mark-stroke[data-mark-id], .canvas-label-item[data-mark-id]',
        'data-mark-id',
      ),
    };
  };
  const selectionTarget = (element: Element) => {
    if (element.closest('input, textarea')) return null;
    const card = Number(
      element.closest('.mind-card:not(.reference-card)')?.getAttribute('data-card-id'),
    );
    if (card) return { kind: 'cards' as const, id: card };
    const mark = Number(element.closest('[data-menu-mark]')?.getAttribute('data-menu-mark'));
    return mark ? { kind: 'marks' as const, id: mark } : null;
  };
  const toggleSelection = ({ kind, id }: NonNullable<ReturnType<typeof selectionTarget>>) => {
    const selectedMark = marks.selected;
    const selectedCard =
      selectedId !== null && cards.some((card) => card.id === selectedId) ? selectedId : null;
    setGroup((current) => {
      const base =
        current.cards.length || current.marks.length
          ? current
          : {
              cards: selectedCard === null ? [] : [selectedCard],
              marks: selectedMark === null ? [] : [selectedMark],
            };
      const items = base[kind];
      return {
        ...base,
        [kind]: items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
      };
    });
    setSelectedId(null);
    setMoveError('');
    marks.cancel();
  };
  const dropFor = (event: PointerEvent<HTMLElement>, current: Drag) =>
    current.selection || (current.card && onThisBoard(current.card))
      ? findDropFolder(event, current.selection?.cards ?? (current.card ? [current.card.id] : []))
      : undefined;
  const offsetFor = (event: PointerEvent<HTMLElement>, current: Drag) => {
    const x = (event.clientX - current.x) / camera.scale;
    const y = (event.clientY - current.y) / camera.scale;
    if (!current.selection) return { x, y };
    const points = [
      ...cards
        .filter(({ id }) => current.selection?.cards.includes(id))
        .map(({ coordinates }) => coordinates),
      ...marks.items
        .filter(({ id }) => current.selection?.marks.includes(id))
        .flatMap((mark) => (mark.kind === 'label' ? [mark.at] : [mark.at, mark.end])),
    ];
    const limit = (value: number, axis: 'x' | 'y') =>
      points.reduce(
        (result, point) =>
          Math.max(-coordinateLimit - point[axis], Math.min(coordinateLimit - point[axis], result)),
        value,
      );
    return { x: limit(x, 'x'), y: limit(y, 'y') };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (resizing.current) {
      if (event.pointerId === resizing.current.pointer)
        setResizePreview({ id: resizing.current.card.id, ...resized(event, resizing.current) });
      return;
    }
    if (marks.tool && marks.move(worldPoint(event), event.shiftKey)) return;
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
      setMarquee({
        rect: new DOMRect(box.x - board.x, box.y - board.y, box.width, box.height),
        selection: selectionIn(box, root.current),
      });
    } else if (current.selection || current.card) {
      const ids = current.selection?.cards ?? (current.card ? [current.card.id] : []);
      const folder = dropFor(event, current);
      setDropFolder(folder ? { id: folder.id, allowed: canMoveToFolder(ids) } : null);
      const offset = offsetFor(event, current);
      if (current.selection) {
        setGroupOffset(offset);
        setTemporary(
          Object.fromEntries(
            cards
              .filter((card) => ids.includes(card.id))
              .map((card) => [
                card.id,
                { x: card.coordinates.x + offset.x, y: card.coordinates.y + offset.y },
              ]),
          ),
        );
      } else if (current.card) {
        setTemporary({
          [current.card.id]: { x: current.startX + offset.x, y: current.startY + offset.y },
        });
      }
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
      if (!cancelled && board && current.moved) {
        setGroup(selectionIn(dragRectangle(current, event, board.getBoundingClientRect()), board));
      }
      return;
    }
    try {
      if (cancelled) return;
      const moved =
        current.moved ||
        Math.abs(event.clientX - current.x) + Math.abs(event.clientY - current.y) > 5;
      if (!moved) {
        if (current.card) {
          if (event.pointerType === 'mouse')
            mouseClick.current = { id: current.card.id, title: current.title };
          else if (!current.selection) selectCard(current.card);
        } else if (!current.selection) {
          marks.cancel();
          setSelectedId(null);
          setGroup(emptySelection);
        }
        return;
      }
      const offset = offsetFor(event, current);
      const folder = dropFor(event, current);
      if (current.selection || folder) {
        const movingCards = current.selection
          ? cards.filter(({ id }) => current.selection?.cards.includes(id))
          : current.card
            ? [current.card]
            : [];
        if (folder && !canMoveToFolder(movingCards.map(({ id }) => id))) {
          setMoveError(linkedMoveError);
          return;
        }
        const movingMarks = current.selection?.marks ?? [];
        const saved = await moveSelection(
          movingCards,
          movingMarks,
          folder ? { destination: folder.id } : { offset },
        );
        marks.applyMoved(saved, Boolean(folder));
        if (folder) setGroup(emptySelection);
      } else if (current.card) {
        const card = current.card;
        const coordinates = { x: current.startX + offset.x, y: current.startY + offset.y };
        if (onThisBoard(card)) await position({ ...card, size: displayedSize(card), coordinates });
        else
          setReferences((value) => ({
            ...value,
            positions: { ...value.positions, [card.id]: coordinates },
          }));
      }
    } catch {
      // Ошибка показана приложением, положение откатывается.
    } finally {
      setTemporary({});
      setGroupOffset(null);
    }
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
      if (event.altKey || (source !== null && event.key !== 'Escape')) return;
      const card = visible.find((item) => item.id === selection);
      if (event.key === '+' || event.key === '-' || event.key === '−') {
        event.preventDefault();
        zoom(camera.scale + (event.key === '+' ? zoomStep : -zoomStep));
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
  const destinationCard = allCards.find((card) => card.id === target);
  const snappedRoute = useMemo(() => {
    if (!sourceCard || !destinationCard || !validTarget(sourceCard.id, destinationCard.id))
      return null;
    const [from, to] = movingStart ? [destinationCard, sourceCard] : [sourceCard, destinationCard];
    const pending: CardLink = {
      source: from.id,
      target: to.id,
      label: '',
      sourceName: from.name,
      targetName: to.name,
      sourceProject: from.project,
      targetProject: to.project,
    };
    const old = reconnecting?.link;
    const planned = [
      ...links.filter((link) => !old || link.source !== old.source || link.target !== old.target),
      pending,
    ].sort((a, b) => a.source - b.source || a.target - b.target);
    return routeBoardLinks(planned, blocks).find(({ link }) => link === pending) ?? null;
  }, [sourceCard, destinationCard, movingStart, reconnecting, links, blocks]);
  const fixedBlock = blocks.find(({ id }) => id === source);
  const targetBlock = blocks.find(({ id }) => id === target && id !== source);
  const fixedPort = fixedBlock ? linkPort(fixedBlock, !movingStart) : null;
  const movingPort = targetBlock ? linkPort(targetBlock, movingStart) : cursor && { at: cursor };
  const draftRoute =
    cursor && fixedPort && movingPort
      ? (snappedRoute ??
        routeConnection(
          movingStart ? movingPort : fixedPort,
          movingStart ? fixedPort : movingPort,
          blocks,
        ))
      : null;
  const highlightedGroup = marquee?.selection ?? group;
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
        if (event.ctrlKey && event.target instanceof Element) {
          const item = selectionTarget(event.target);
          if (item) {
            if (
              !modifierSelectionHandled.current &&
              !busy &&
              !marks.locked &&
              !marks.tool &&
              source === null
            ) {
              toggleSelection(item);
            }
            modifierSelectionHandled.current = false;
            event.preventDefault();
            return;
          }
        }
        if (event.target instanceof Element && showMenu(event.target, event)) {
          event.preventDefault();
        }
      }}
      onClickCapture={(event) => {
        if (!mouseClick.current || mouseClick.current.title) previousBodyClick.current = null;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.target instanceof Element &&
          selectionTarget(event.target)
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === ' ' &&
          event.target instanceof Element &&
          !busy &&
          !marks.locked &&
          !marks.tool &&
          source === null
        ) {
          const target = selectionTarget(event.target);
          if (target) {
            event.preventDefault();
            toggleSelection(target);
            return;
          }
        }
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        if (!(event.target instanceof Element)) return;
        const rect = event.target.getBoundingClientRect();
        if (showMenu(event.target, { clientX: rect.left + 12, clientY: rect.top + 12 }))
          event.preventDefault();
      }}
      onPointerDownCapture={(event) => {
        mouseClick.current = null;
        modifierSelectionHandled.current = false;
        if (
          event.button === 0 &&
          event.target instanceof Element &&
          !busy &&
          !marks.locked &&
          !marks.tool &&
          source === null
        ) {
          const item = selectionTarget(event.target);
          if (item && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.stopPropagation();
            toggleSelection(item);
            modifierSelectionHandled.current = true;
            return;
          }
          if (item?.kind === 'marks' && event.target.closest('.mark-hit,.canvas-label')) {
            if (group.marks.includes(item.id)) start(event, null, false, true);
            else {
              setGroup(emptySelection);
              setSelectedId(null);
            }
          }
        }
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
      {marquee && (
        <div
          className="board-marquee"
          aria-hidden="true"
          style={{
            left: marquee.rect.x,
            top: marquee.rect.y,
            width: marquee.rect.width,
            height: marquee.rect.height,
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
      {(notifications || moveError) && (
        <div className="memo-toast-stack" onPointerDown={(event) => event.stopPropagation()}>
          {moveError && (
            <Toast kind="error" onDismiss={() => setMoveError('')}>
              {moveError}
            </Toast>
          )}
          {notifications}
        </div>
      )}
      {dropFolder?.allowed === false && (
        <div className="board-move-error" role="status">
          {linkedMoveError}
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
          group={highlightedGroup.marks}
          offset={groupOffset}
        />
        <svg className="connections" width="1" height="1" aria-hidden="true">
          {routedLinks.map(({ link, key, d, start, end }) => {
            const grouped =
              highlightedGroup.cards.includes(link.source) &&
              highlightedGroup.cards.includes(link.target);
            const appearance =
              grouped || related(link) ? 'related-link' : selection === null ? '' : 'dimmed-link';
            return (
              <g key={key}>
                <path
                  d={d}
                  className={`${appearance} ${reconnecting?.link.source === link.source && reconnecting.link.target === link.target ? 'reconnecting-link' : ''}`}
                />
                <path
                  d={d}
                  className="link-hit"
                  onPointerDown={(event) => startReconnection(event, link, start, end)}
                  onPointerEnter={() => setHoveredLink(key)}
                  onPointerLeave={() => setHoveredLink(null)}
                  onClick={() => {
                    if (!suppressLinkClick.current) document.getElementById(`edge-${key}`)?.focus();
                  }}
                />
              </g>
            );
          })}
          {sourceCard && draftRoute && (
            <path
              className={`draft-link ${target !== null && !validTarget(sourceCard.id, target) ? 'invalid' : ''}`}
              d={draftRoute.d}
            />
          )}
        </svg>
        {routedLinks.map(({ link, key, center }) => (
          <LinkControl
            key={key}
            link={link}
            highlighted={hoveredLink === key}
            dimmed={selection !== null && !related(link)}
            busy={busy}
            style={{ left: center.x, top: center.y }}
            save={(item, label) => connect(item.source, item.target, label)}
            remove={disconnect}
            reassign={(moving) => selectReconnection(link, moving)}
          />
        ))}
        {visible.map((card) => {
          const connected = source !== null && target === card.id;
          const local = onThisBoard(card);
          const isFolder = card.kind === 'folder';
          const grouped = highlightedGroup.cards.includes(card.id);
          const cardSize = size(card);
          const autoHeight = isAutoHeight(card) && resizePreview?.id !== card.id;
          const style: CSSProperties & { '--card-title-lines': number } = {
            left: point(card).x,
            top: point(card).y,
            width: cardSize.width,
            height: autoHeight ? undefined : cardSize.height,
            '--card-title-lines': Math.max(
              1,
              Math.floor((cardSize.height - cardVerticalInsets) / cardTitleLineHeight),
            ),
          };
          return (
            <article
              key={card.id}
              ref={observeCard}
              data-card-id={card.id}
              data-auto-height={autoHeight || undefined}
              className={`mind-card ${local ? '' : 'reference-card'} ${connected ? (validTarget(source ?? card.id, card.id) ? 'valid-target' : 'invalid-target') : ''} ${grouped ? 'grouped-card' : selection === card.id ? 'focused-card' : neighbors.has(card.id) ? 'related-card' : ''} ${dropFolder?.id === card.id ? (dropFolder.allowed ? 'folder-drop-target' : 'folder-drop-rejected') : ''} ${temporary[card.id] ? 'dragging-card' : ''}`}
              style={style}
              onPointerDown={(event) => start(event, card)}
              onClick={(event) => {
                const click = mouseClick.current;
                if (!event.detail || click?.id !== card.id) return;
                mouseClick.current = null;
                if (busy || source !== null || marks.tool) return;
                if (click.title) setTitleCardId(card.id);
                else {
                  const doubleClick = event.detail === 2 && previousBodyClick.current === card.id;
                  previousBodyClick.current = card.id;
                  if (doubleClick) selectCard(card);
                  else if (!grouped) highlightCard(card.id);
                }
              }}
            >
              {titleCardId === card.id ? (
                <CardTitleEditor
                  card={card}
                  save={(name, height) => saveTitle(card.id, name, height)}
                  close={() => setTitleCardId((id) => (id === card.id ? null : id))}
                />
              ) : (
                <button
                  className="card-title"
                  disabled={busy}
                  title={card.name}
                  aria-keyshortcuts={source === null ? 'F2' : undefined}
                  aria-label={
                    source !== null
                      ? `Связать с ${card.name}`
                      : isFolder
                        ? `Открыть папку ${card.name}`
                        : `Открыть запись ${card.name}`
                  }
                  aria-pressed={source === null ? grouped || selection === card.id : undefined}
                  onFocus={() => {
                    if (source !== null) setTarget(card.id);
                  }}
                  onBlur={() => {
                    if (!linking.current) setTarget(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'F2' || busy || source !== null || marks.tool) return;
                    event.preventDefault();
                    setTitleCardId(card.id);
                  }}
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey) return;
                    if (source !== null && !linking.current) void finishLink(source, card.id);
                    else if (event.detail === 0) selectCard(card);
                  }}
                >
                  <span>{card.name}</span>
                </button>
              )}
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
              <div
                className="card-actions"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <IconButton
                  icon="pencil"
                  iconSize={22.5}
                  label={`Открыть карточку: ${card.name}`}
                  disabled={busy || source !== null || !!marks.tool}
                  onClick={() => selectCard(card)}
                />
                <IconButton
                  className="card-action link-output"
                  icon={local ? 'plus' : 'board'}
                  iconSize={27}
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
                <IconButton
                  className="canvas-trash card-trash"
                  icon="trash"
                  iconSize={22.5}
                  label={`Удалить: ${card.name}`}
                  disabled={busy}
                  onClick={() => setTrashCandidate(card)}
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
        <button aria-label="Уменьшить масштаб" onClick={() => zoom(camera.scale - zoomStep)}>
          −
        </button>
        <input
          aria-label="Масштаб полотна"
          type="range"
          min={Math.round((minScale / defaultScale) * 100)}
          max={Math.round((maxScale / defaultScale) * 100)}
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
        <button aria-label="Увеличить масштаб" onClick={() => zoom(camera.scale + zoomStep)}>
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
