import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { api } from './api';
import { Board } from './Board';
import { CardEditor } from './CardEditor';
import { GuestAuthDialog } from './GuestAuthDialog';
import { createGuestWorkspace, guestProjectId } from './guestWorkspace';
import { PanelDivider } from './PanelDivider';
import { ProjectActions } from './ProjectActions';
import { ProjectCreateDialog } from './ProjectCreateDialog';
import { cardDimensions, childPosition, clampCardSize, excerpt } from './graph';
import { parseRoute, routeUrl } from './routes';
import type { EntityRef, Route } from './routes';
import { isTextInput, markTools, shortcutHelp } from './shortcuts';
import {
  clearGuestStorage,
  draftKey,
  guestUserId,
  listDrafts,
  readLocal,
  removeLocal,
  writeLocal,
} from './storage';
import { folderTrail } from './types';
import type {
  BoardSelection,
  BoardClipboard,
  BoardMove,
  Card,
  CardLink,
  Folder,
  GuestProjectSnapshot,
  Project,
  Template,
  Trash,
  User,
} from './types';
import { Button, ConfirmDialog, Icon, IconButton, Popover, Toast } from './ui';
import { WorkspaceClient } from './WorkspaceClient';

type BlockKind = 'record' | 'folder';

const panelKey = 'memo:panels';
function panelPreferences() {
  const saved = readLocal(panelKey);
  const defaults = { left: 248, right: 450, collapsed: false };
  if (!saved || typeof saved !== 'object') return defaults;
  return {
    left:
      'left' in saved && typeof saved.left === 'number' && saved.left >= 176 && saved.left <= 410
        ? saved.left
        : defaults.left,
    right:
      'right' in saved &&
      typeof saved.right === 'number' &&
      saved.right >= 270 &&
      saved.right <= 690
        ? saved.right
        : defaults.right,
    collapsed: 'collapsed' in saved && saved.collapsed === true,
  };
}

type View = Route['view'];
type RecordRoute = Extract<Route, { view: 'record' }>;
const base = import.meta.env.BASE_URL;
const guestRoute: Route = { view: 'project', project: guestProjectId };
const guestIdentity: User = { id: guestUserId, email: '' };
type PendingTransfer = { account: User; snapshot: GuestProjectSnapshot; requestId: string };
const currentRoute = () => parseRoute(location.pathname, base);
const urlFor = (route: Route) => routeUrl(base, route);
const reasonText = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Не удалось выполнить действие.';

function WorkspaceTitle({
  name,
  label,
  save,
}: {
  name: string;
  label: string;
  save: (name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null);

  const finish = (restoreFocus: boolean) => {
    setDraft(null);
    setError('');
    if (restoreFocus) requestAnimationFrame(() => button.current?.focus());
  };
  const commit = async (input: HTMLInputElement) => {
    if (draft === null || saving) return;
    const next = draft.trim();
    if (next === name) {
      finish(input === document.activeElement);
      return;
    }
    if (!next) {
      setError('Введите название.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await save(next);
      finish(input === document.activeElement);
    } catch (reason) {
      setError(reasonText(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1>
        {draft === null ? (
          <button
            ref={button}
            className="workspace-title-button"
            title={`Изменить название: ${name}`}
            onClick={() => setDraft(name)}
          >
            {name}
          </button>
        ) : (
          <input
            autoFocus
            className="workspace-title-input"
            aria-label={label}
            aria-invalid={!!error}
            aria-describedby={error ? 'workspace-title-error' : undefined}
            maxLength={128}
            readOnly={saving}
            value={draft}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
            onBlur={(event) => void commit(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                void commit(event.currentTarget);
              }
              if (event.key === 'Escape' && !saving) {
                event.preventDefault();
                finish(true);
              }
            }}
          />
        )}
      </h1>
      {error && (
        <p className="workspace-title-error" id="workspace-title-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const names: Record<View, string> = {
  dashboard: 'Мои проекты',
  project: 'Проект',
  record: 'Запись',
  inbox: 'Входящие',
  recent: 'Недавние записи',
  search: 'Поиск по Memo',
  trash: 'Корзина',
  drafts: 'Черновики на устройстве',
};
const navigation: { view: Exclude<View, 'project' | 'record'>; icon: string; label: string }[] = [
  { view: 'dashboard', icon: '▦', label: 'Мои проекты' },
  { view: 'inbox', icon: '↓', label: 'Входящие' },
  { view: 'recent', icon: '◷', label: 'Недавние' },
  { view: 'drafts', icon: '✎', label: 'Черновики' },
  { view: 'trash', icon: '⌫', label: 'Корзина' },
];

function CardList({
  cards,
  projects,
  query = '',
  open,
  locate,
}: {
  cards: Card[];
  projects: Project[];
  query?: string;
  open: (card: Card) => void;
  locate: (card: Card) => void;
}) {
  return (
    <div className="record-list">
      {cards.map((card) => {
        const text = excerpt(card);
        const match = query
          ? text.toLocaleLowerCase('ru').indexOf(query.toLocaleLowerCase('ru'))
          : 0;
        const start = Math.max(0, match - 60);
        const summary = `${start ? '…' : ''}${text.slice(start, start + 220)}`;
        return (
          <article className="record-row" key={card.id}>
            <button className="record-open" onClick={() => open(card)}>
              <span className="record-project">
                {projects.find((project) => project.id === card.project)?.name ?? 'Проект'}
              </span>
              <h3>{card.name}</h3>
              <p>{card.kind === 'folder' ? 'Папка' : summary || 'Пока без содержания'}</p>
            </button>
            <button
              className="text-button locate-button"
              onClick={() => locate(card)}
              aria-label={`Показать на полотне ${card.name}`}
            >
              На полотне ↗
            </button>
          </article>
        );
      })}
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<User | null>(null);
  const [guest, setGuest] = useState(createGuestWorkspace);
  const guestMode = !account;
  const user = account ?? (ready ? guestIdentity : null);
  const workspaceApi = guestMode ? guest.client : api;
  const entryRoute = useRef(currentRoute());
  const [authOpen, setAuthOpen] = useState(false);
  const [authError, setAuthError] = useState('');
  const [transfer, setTransfer] = useState<PendingTransfer | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsStatus, setProjectsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [route, setRoute] = useState<Route>(currentRoute);
  const [cards, setCards] = useState<Card[]>([]);
  const [workspace, setWorkspace] = useState<{
    project: Project;
    folders: Folder[];
    folder: number | null;
    linked?: { route: RecordRoute; card: Card };
  } | null>(null);
  const openedLink = useRef<RecordRoute | undefined>(undefined);
  const [links, setLinks] = useState<CardLink[]>([]);
  const [trash, setTrash] = useState<Trash>({ cards: [], projects: [] });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const [editing, setEditing] = useState<Card | null>(null);
  const [openForEditing, setOpenForEditing] = useState(false);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const projectCreateButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const pendingBlock = useRef<
    Partial<Record<BlockKind, { requestId: string; coordinates?: Card['coordinates'] }>>
  >({});
  const [boardClipboard, setBoardClipboard] = useState<BoardClipboard | null>(null);
  const pendingPaste = useRef<{ requestId: string; coordinates: Card['coordinates'] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ project: Project } | { draft: Card } | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletedItem, setDeletedItem] = useState<{ id: number; type: 'card' | 'project' } | null>(
    null,
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(() => currentRoute().view === 'search');
  const shortcutsButton = useRef<HTMLButtonElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [boardAddOpen, setBoardAddOpen] = useState(false);
  const boardAddButton = useRef<HTMLButtonElement>(null);
  const [drawingTool, setDrawingTool] = useState<(typeof markTools)[number]['kind'] | null>(null);
  const draw = (kind: NonNullable<typeof drawingTool>) => {
    setViewMode('board');
    setDrawingTool(kind);
  };
  const chooseAddAction = (action: () => void) => {
    boardAddButton.current?.focus();
    setBoardAddOpen(false);
    action();
  };
  const [panels, setPanels] = useState(panelPreferences);
  useEffect(() => {
    writeLocal(panelKey, panels);
  }, [panels]);
  const showingProjects = route.view === 'dashboard';
  const visibleProjects = projects.filter((project) => !project.inbox);
  const projectRef = route.view === 'project' ? route.project : undefined;
  const folderRef = route.view === 'project' ? route.folder : undefined;
  const recordRoute = route.view === 'record' ? route : undefined;
  const workspaceView = route.view === 'project' || route.view === 'record';
  const loadKey = `${route.view}:${projectRef ?? recordRoute?.record ?? ''}:${folderRef ?? ''}:${route.view === 'search' ? query : ''}`;
  const currentBoard = workspaceView && loadedKey === loadKey ? workspace : null;
  const selected = currentBoard?.project.id;
  const folder = currentBoard?.folder ?? null;
  const active = projects.find((project) => project.id === selected) ?? currentBoard?.project;
  const trail = currentBoard ? folderTrail(currentBoard.folders, folder) : [];
  const activeFolder = trail.at(-1);
  const boardRoute: Route | null = currentBoard
    ? {
        view: 'project',
        project: currentBoard.project.publicId ?? currentBoard.project.id,
        folder: activeFolder?.publicId,
      }
    : null;
  const currentUrl = urlFor(route.view === 'project' && boardRoute ? boardRoute : route);
  const drafts = user ? listDrafts(user.id) : [];

  useEffect(() => {
    let live = true;
    const enterGuest = () => {
      setRoute(guestRoute);
      setSearchOpen(false);
      if (entryRoute.current.view === 'project' || entryRoute.current.view === 'record') {
        setAuthOpen(true);
      }
    };
    void api
      .session()
      .then((session) => {
        if (!live) return;
        if (session.user) setAccount(session.user);
        else enterGuest();
      })
      .catch((reason: unknown) => {
        if (live) {
          setAuthError(reasonText(reason));
          enterGuest();
        }
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setProjectsStatus('loading');
    void workspaceApi
      .projects(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setProjects(items);
          setProjectsStatus('ready');
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setProjectsStatus('error');
          if (!showingProjects) setError(reasonText(reason));
        }
      });
    return () => controller.abort();
  }, [user, revision, showingProjects]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void workspaceApi
      .links(controller.signal)
      .then((edges) => {
        if (!controller.signal.aborted) setLinks(edges);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reasonText(reason));
      });
    return () => controller.abort();
  }, [user, revision]);
  useEffect(() => {
    setShortcutsOpen(false);
    pendingBlock.current = {};
    pendingPaste.current = null;
  }, [route.view, projectRef, folderRef, recordRoute]);
  useEffect(() => {
    if (!user || route.view === 'dashboard') return;
    const controller = new AbortController();
    setLoading(true);
    setLoaded(false);
    setError('');
    setHasMore(false);
    setCards([]);
    const timer = window.setTimeout(
      () => {
        const load = async () => {
          const signal = controller.signal;
          let card = recordRoute ? await workspaceApi.card(recordRoute.record, signal) : null;
          if (card?.kind === 'folder') throw new Error('Запись недоступна.');
          const openLink = recordRoute && openedLink.current !== recordRoute;
          if (card && openLink) card = await workspaceApi.visit(card.id, signal);
          const projectRefForBoard = card?.project ?? projectRef;
          if (projectRefForBoard !== undefined) {
            const [project, tree] = await Promise.all([
              workspaceApi.project(projectRefForBoard, signal),
              workspaceApi.folders(projectRefForBoard, signal),
            ]);
            const folderRefForBoard = card?.folder ?? folderRef;
            const target = tree.find(
              (item) => item.publicId === folderRefForBoard || item.id === folderRefForBoard,
            );
            if (folderRefForBoard !== undefined && !target) throw new Error('Папка не найдена.');
            const folder = target?.id ?? null;
            const result = await workspaceApi.cards(project.id, folder, signal);
            if (!signal.aborted) {
              setWorkspace({
                project,
                folders: tree,
                folder,
                linked: card && recordRoute && openLink ? { route: recordRoute, card } : undefined,
              });
              setCards(result);
            }
          } else if (route.view === 'trash') {
            const result = await api.trash();
            if (!controller.signal.aborted) setTrash(result);
          } else if (route.view !== 'drafts') {
            const filter = route.view === 'inbox' || route.view === 'recent' ? route.view : 'all';
            const result = await api.search(
              route.view === 'search' ? query : '',
              filter,
              controller.signal,
            );
            if (!controller.signal.aborted) {
              setCards(result.cards);
              setHasMore(result.hasMore);
            }
          }
          if (!controller.signal.aborted) setLoaded(true);
        };
        void load()
          .catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reasonText(reason));
          })
          .finally(() => {
            if (!controller.signal.aborted) {
              setLoading(false);
              setLoadedKey(loadKey);
            }
          });
      },
      route.view === 'search' ? 250 : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [user, route.view, projectRef, folderRef, recordRoute, query, revision]);
  useEffect(() => {
    const linked = currentBoard?.linked;
    if (!linked || linked.route !== recordRoute || openedLink.current === recordRoute || editing)
      return;
    openedLink.current = recordRoute;
    setViewMode('board');
    setFocusId(linked.card.id);
    setOpenForEditing(false);
    setEditing(linked.card);
  }, [currentBoard, recordRoute, editing]);
  useEffect(() => {
    if (!guestMode && currentBoard && loaded && location.pathname !== currentUrl) {
      history.replaceState(history.state, '', currentUrl + location.search + location.hash);
    }
  }, [currentBoard, currentUrl, loaded, guestMode]);
  useEffect(() => {
    const update = () => {
      if (guestMode) return;
      if (editing) document.getElementById('close-editor')?.click();
      setRoute(currentRoute());
      setBoardAddOpen(false);
      setDrawingTool(null);
      setFocusId(null);
    };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, [editing, guestMode]);
  const navigate = (next: Route, focus: number | null = null) => {
    if (editing) document.getElementById('close-editor')?.click();
    if (!guestMode) history.pushState(null, '', urlFor(next));
    setRoute(next);
    setBoardAddOpen(false);
    setDrawingTool(null);
    setFocusId(focus);
    setError('');
  };
  const perform = async <T,>(work: () => Promise<T>) => {
    setBusy(true);
    setError('');
    try {
      return await work();
    } catch (reason) {
      setError(reasonText(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  };
  const run = (work: () => Promise<void>) => {
    void perform(work).catch(() => {});
  };
  const refreshLinks = async () => setLinks(await workspaceApi.links());
  const refresh = () => setRevision((value) => value + 1);
  const replaceCard = (card: Card) => {
    setCards((items) => items.map((item) => (item.id === card.id ? card : item)));
    setLinks((items) =>
      items.map((link) => ({
        ...link,
        ...(link.source === card.id ? { sourceName: card.name, sourceProject: card.project } : {}),
        ...(link.target === card.id ? { targetName: card.name, targetProject: card.project } : {}),
      })),
    );
  };
  const renameCard = async (id: number, name: string, height?: number) => {
    const card = await workspaceApi.card(id);
    const size =
      height && card.autoHeight !== false
        ? clampCardSize(cardDimensions(card).width, height)
        : card.size;
    const renamed = await workspaceApi.saveCard({ ...card, name, size }, crypto.randomUUID());
    replaceCard(renamed);
    setEditing((current) => (current?.id === renamed.id ? renamed : current));
    if (renamed.kind === 'folder')
      setWorkspace(
        (current) =>
          current && {
            ...current,
            folders: current.folders.map((item) =>
              item.id === renamed.id ? { ...item, name: renamed.name } : item,
            ),
          },
      );
    return renamed;
  };
  const renameTitle = async (project: Project, currentFolder: Folder | undefined, name: string) => {
    if (currentFolder) {
      await renameCard(currentFolder.id, name);
      return;
    }
    const renamed = await workspaceApi.renameProject(project.id, name);
    setProjects((items) =>
      items.map((item) => (item.id === renamed.id ? { ...item, ...renamed } : item)),
    );
    setWorkspace((current) =>
      current?.project.id === renamed.id ? { ...current, project: renamed } : current,
    );
  };
  const openId = (id: number, edit = false) => {
    if (editing?.id === id) {
      if (edit) document.querySelector<HTMLButtonElement>('[data-edit-record]')?.click();
      return;
    }
    const closeButton = document.getElementById('close-editor');
    if (closeButton instanceof HTMLButtonElement && closeButton.disabled) return;
    run(async () => {
      const result = await workspaceApi.visit(id);
      replaceCard(result);
      setOpenForEditing(edit);
      setEditing(result);
    });
  };
  const locate = (card: Card) => {
    setViewMode('board');
    const project = projects.find((item) => item.id === card.project);
    navigate(
      {
        view: 'project',
        project: project?.publicId ?? card.project,
        folder: card.folder ?? undefined,
      },
      card.id,
    );
  };
  const enterFolder = (id: EntityRef, projectId: number) => {
    setViewMode('board');
    const project = projects.find((item) => item.id === projectId);
    navigate({ view: 'project', project: project?.publicId ?? projectId, folder: id });
  };
  const openFromList = (card: Card) => {
    if (card.kind === 'folder') enterFolder(card.publicId ?? card.id, card.project);
    else openId(card.id);
  };
  const finishAuth = (signedIn: User, project?: Project) => {
    const next: Route = project
      ? { view: 'project', project: project.publicId ?? project.id }
      : entryRoute.current;
    clearGuestStorage();
    setGuest(createGuestWorkspace());
    setTransfer(null);
    setAuthOpen(false);
    setEditing(null);
    setCards([]);
    setLinks([]);
    setProjects([]);
    setWorkspace(null);
    setLoaded(false);
    setLoadedKey('');
    setBoardClipboard(null);
    setFocusId(null);
    setViewMode('board');
    setSearchOpen(next.view === 'search');
    setDeletedItem(null);
    setNotice(project ? 'Полотно сохранено в аккаунте.' : '');
    setAccount(signedIn);
    history.replaceState(null, '', urlFor(next));
    setRoute(next);
  };
  const importWorkspace = async (pending: PendingTransfer) => {
    const project = await api.importGuest(pending.snapshot, pending.requestId);
    finishAuth(pending.account, project);
  };
  const runAuth = (work: () => Promise<void>) => {
    setAuthError('');
    setBusy(true);
    void work()
      .catch((reason: unknown) => setAuthError(reasonText(reason)))
      .finally(() => setBusy(false));
  };
  const authenticate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    runAuth(async () => {
      const identifier = String(data.get('email'));
      const email =
        import.meta.env.DEV && mode === 'login' && identifier.trim().toLowerCase() === 'admin'
          ? 'admin@memo.local'
          : identifier;
      await api.session();
      const { user: signedIn } = await api.auth(mode, email, String(data.get('password')));
      if (!signedIn) throw new Error('Не удалось открыть аккаунт.');
      const snapshot = guest.snapshot();
      if (!snapshot) {
        finishAuth(signedIn);
        return;
      }
      const pending = { account: signedIn, snapshot, requestId: crypto.randomUUID() };
      setTransfer(pending);
      await importWorkspace(pending);
    });
  };
  const logout = () =>
    run(async () => {
      await api.logout();
      clearGuestStorage();
      setGuest(createGuestWorkspace());
      setAccount(null);
      setLoaded(false);
      setLoadedKey('');
      entryRoute.current = { view: 'dashboard' };
      setRoute(guestRoute);
      setViewMode('board');
      history.replaceState(null, '', base);
      setProjects([]);
      setCards([]);
      setWorkspace(null);
      openedLink.current = undefined;
      setLinks([]);
      setTrash({ cards: [], projects: [] });
      setQuery('');
      setSearchOpen(false);
      setBoardClipboard(null);
      setDeletedItem(null);
      setNotice('');
      setEditing(null);
    });
  const createProject = async (name: string, template: Template, requestId: string) => {
    const result = await api.createProject(name, template, requestId);
    setProjects((items) => [result, ...items.filter((item) => item.id !== result.id)]);
    setProjectCreateOpen(false);
    setViewMode('board');
    navigate({ view: 'project', project: result.publicId ?? result.id });
    refresh();
  };
  const dismissProjectCreate = () => {
    setProjectCreateOpen(false);
    requestAnimationFrame(() => projectCreateButton.current?.focus());
  };
  const openSearch = () => {
    setShortcutsOpen(false);
    setSearchOpen(true);
    searchInput.current?.focus();
  };
  const dismissSearch = () => {
    setSearchOpen(false);
    requestAnimationFrame(() => searchButton.current?.focus());
  };
  const createBlock = (kind: BlockKind, coordinates?: Card['coordinates']) => {
    if (!active || busy || !loaded || loadedKey !== loadKey) return;
    const pending = pendingBlock.current;
    const operation = pending[kind] ?? { requestId: crypto.randomUUID(), coordinates };
    pending[kind] = operation;
    setShortcutsOpen(false);
    run(async () => {
      const created = await workspaceApi.capture({
        ...operation,
        project: active.id,
        folder: folder ?? undefined,
        kind,
        content: [],
      });
      delete pending[kind];
      if (!operation.coordinates) setFocusId(created.id);
      refresh();
    });
  };
  const pasteCard = (source: number, coordinates: Card['coordinates']) => {
    if (!active || busy || !loaded || loadedKey !== loadKey) return;
    const operation = pendingPaste.current ?? { requestId: crypto.randomUUID(), coordinates };
    pendingPaste.current = operation;
    run(async () => {
      await workspaceApi.copyCard(source, { ...operation, project: active.id, folder });
      if (pendingPaste.current === operation) pendingPaste.current = null;
      refresh();
    });
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!user || authOpen || projectCreateOpen || event.defaultPrevented || event.isComposing)
        return;
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      if (
        !guestMode &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === 'KeyK'
      ) {
        event.preventDefault();
        openSearch();
        return;
      }
      if (event.key === 'Escape' && editing && !isTextInput(event)) {
        event.preventDefault();
        document.getElementById('close-editor')?.click();
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat || isTextInput(event))
        return;
      const tool =
        event.shiftKey && !busy && workspaceView && active && loaded && loadedKey === loadKey
          ? markTools.find(({ key }) => event.code === `Key${key}`)
          : undefined;
      if (tool) {
        event.preventDefault();
        setSearchOpen(false);
        setShortcutsOpen(false);
        setBoardAddOpen(false);
        draw(tool.kind);
      } else if (event.shiftKey && event.code === 'KeyH') {
        event.preventDefault();
        setSearchOpen(false);
        setShortcutsOpen(true);
        shortcutsButton.current?.focus();
      } else if (
        event.shiftKey &&
        workspaceView &&
        (event.code === 'KeyN' || event.code === 'KeyF')
      ) {
        event.preventDefault();
        setShortcutsOpen(false);
        setBoardAddOpen(false);
        createBlock(event.code === 'KeyN' ? 'record' : 'folder');
      } else if (
        event.shiftKey &&
        workspaceView &&
        (event.code === 'KeyB' || event.code === 'KeyV')
      ) {
        event.preventDefault();
        setShortcutsOpen(false);
        setViewMode(event.code === 'KeyB' ? 'board' : 'list');
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });
  const createChild = (parent: Card) =>
    run(async () => {
      const withText = await workspaceApi.capture({
        requestId: crypto.randomUUID(),
        project: parent.project,
        folder: parent.folder ?? undefined,
        parent: parent.id,
        coordinates: childPosition(cards, parent),
        name: 'Новая запись',
        text: '',
      });
      setCards((items) => [...items, withText]);
      setFocusId(withText.id);
      await refreshLinks();
    });
  const updatePosition = (card: Card) =>
    perform(async () => {
      replaceCard(await workspaceApi.position(card));
    });
  const moveSelection = (moving: Card[], marks: number[], motion: BoardMove) =>
    perform(async () => {
      if (selected === undefined) return [];
      const saved = await workspaceApi.moveSelection(selected, folder, moving, marks, motion);
      const byId = new Map(saved.cards.map((card) => [card.id, card]));
      if ('destination' in motion) {
        setCards((items) => items.filter((item) => !byId.has(item.id)));
        setFocusId(null);
        setDeletedItem(null);
        setNotice('Выбранные элементы перемещены в папку.');
        if (moving.some((card) => card.kind === 'folder')) refresh();
      } else {
        setCards((items) => items.map((card) => byId.get(card.id) ?? card));
      }
      return saved.marks;
    });
  const removeSelection = (selection: BoardSelection, requestId: string) =>
    perform(async () => {
      if (selected === undefined) return;
      await workspaceApi.trashSelection(
        selected,
        folder,
        selection.cards,
        selection.marks,
        requestId,
      );
      setCards((items) => items.filter((item) => !selection.cards.includes(item.id)));
      setFocusId(null);
      setDeletedItem(null);
      setNotice('Выбранные элементы удалены.');
      refresh();
    });
  const connect = (source: number, target: number, label = '') =>
    perform(async () => {
      await workspaceApi.connect(source, target, label);
      await refreshLinks();
      replaceCard(await workspaceApi.card(target));
    });
  const disconnect = (link: CardLink) =>
    perform(async () => {
      await workspaceApi.disconnect(link);
      await refreshLinks();
      replaceCard(await workspaceApi.card(link.target));
    });
  const reconnect = (link: CardLink, newSource: number, newTarget: number) =>
    perform(async () => {
      try {
        await workspaceApi.reconnectLink(link, newSource, newTarget);
        setDeletedItem(null);
        setNotice('Связь изменена.');
      } finally {
        refresh();
      }
    });
  const remove = (card: Card) =>
    perform(async () => {
      await workspaceApi.deleteCard(card.id);
      setDeletedItem({ id: card.id, type: 'card' });
      setNotice(
        card.kind === 'folder' ? 'Папка перемещена в корзину.' : 'Запись перемещена в корзину.',
      );
      refresh();
    });
  const requestDelete = (target: NonNullable<typeof confirmDelete>) => {
    setDeleteError('');
    setConfirmDelete(target);
  };
  const deleteConfirmed = () => {
    if (!confirmDelete || busy) return;
    if ('draft' in confirmDelete) {
      if (user) removeLocal(draftKey(user.id, confirmDelete.draft.id));
      setConfirmDelete(null);
      refresh();
      return;
    }
    const project = confirmDelete.project;
    void perform(async () => {
      await api.deleteProject(project.id);
      setConfirmDelete(null);
      setDeletedItem({ id: project.id, type: 'project' });
      setNotice('Проект перемещён в корзину.');
      navigate({ view: 'dashboard' });
      refresh();
    }).catch((reason: unknown) => setDeleteError(reasonText(reason)));
  };
  const exportProject = (project: Project) => {
    run(async () => {
      const result = await api.exportProject(project.id);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `memo-project-${project.id}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Проект экспортирован вместе с загруженными файлами.');
    });
  };
  const restore = (id: number, type: 'card' | 'project') =>
    run(async () => {
      if (type === 'card') await workspaceApi.restoreCard(id);
      else await api.restoreProject(id);
      setDeletedItem(null);
      setNotice(
        type === 'card' ? 'Запись восстановлена вместе со связями.' : 'Проект восстановлен.',
      );
      refresh();
    });

  if (!user) return <main className="loading-screen">Загружаем пространство…</main>;

  const toasts = (error || notice) && (
    <>
      {error && (
        <Toast
          kind="error"
          action={{
            label: 'Повторить',
            run: () => {
              setError('');
              refresh();
            },
            disabled: busy,
          }}
          onDismiss={() => setError('')}
        >
          {error}
        </Toast>
      )}
      {notice && (
        <Toast
          kind="success"
          action={
            deletedItem
              ? {
                  label: 'Отменить удаление',
                  run: () => restore(deletedItem.id, deletedItem.type),
                  disabled: busy,
                }
              : undefined
          }
          onDismiss={() => {
            setNotice('');
            setDeletedItem(null);
          }}
        >
          {notice}
        </Toast>
      )}
    </>
  );
  const showingBoard =
    workspaceView && viewMode === 'board' && !loading && loaded && loadedKey === loadKey;
  const docking: CSSProperties & Record<'--memo-sidebar-width' | '--memo-record-width', string> = {
    '--memo-sidebar-width': `${panels.collapsed ? 62 : panels.left}px`,
    '--memo-record-width': `${panels.right}px`,
  };
  return (
    <WorkspaceClient.Provider value={workspaceApi}>
      <div
        className={`application ${editing ? 'has-record-dock' : ''}`}
        style={docking}
        inert={projectCreateOpen || authOpen}
      >
        <aside
          className={`sidebar ${panels.collapsed ? 'sidebar-collapsed' : ''}`}
          id="memo-sidebar"
        >
          <div className="sidebar-top">
            <a
              className="brand"
              aria-label="Memo"
              href={base}
              onClick={(event) => {
                event.preventDefault();
                navigate(guestMode ? guestRoute : { view: 'dashboard' });
              }}
            >
              <span className="brand-mark">m.</span>
              <span className="sidebar-label">Memo</span>
            </a>
            <IconButton
              icon="sidebar"
              className="sidebar-toggle"
              label={panels.collapsed ? 'Развернуть левую панель' : 'Свернуть левую панель'}
              aria-expanded={!panels.collapsed}
              aria-controls="memo-sidebar"
              onClick={() =>
                setPanels((current) => ({ ...current, collapsed: !current.collapsed }))
              }
            />
          </div>
          {!guestMode && (
            <>
              <p className="nav-section">ЛИЧНОЕ ПРОСТРАНСТВО</p>
              <nav className="main-navigation" aria-label="Личное пространство">
                {navigation.map((item) => (
                  <button
                    key={item.view}
                    className={`nav-item ${route.view === item.view ? 'selected' : ''}`}
                    disabled={busy}
                    onClick={() => navigate({ view: item.view })}
                    aria-label={item.label}
                    title={panels.collapsed ? item.label : undefined}
                    aria-current={route.view === item.view ? 'page' : undefined}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span className="sidebar-label">{item.label}</span>
                    {item.view === 'drafts' && drafts.length > 0 && <small>{drafts.length}</small>}
                  </button>
                ))}
              </nav>
            </>
          )}
          {visibleProjects.length > 0 && (
            <>
              <p className="nav-section">ПРОЕКТЫ</p>
              <nav className="project-navigation" aria-label="Проекты">
                {visibleProjects.map((project) => (
                  <button
                    key={project.id}
                    className={`nav-item ${selected === project.id ? 'selected' : ''}`}
                    disabled={busy}
                    onClick={() =>
                      navigate({ view: 'project', project: project.publicId ?? project.id })
                    }
                    aria-label={project.name}
                    title={panels.collapsed ? project.name : undefined}
                  >
                    <span className="project-dot" aria-hidden="true">
                      <span>{project.name.slice(0, 1).toLocaleUpperCase('ru')}</span>
                    </span>
                    <span className="sidebar-label">{project.name}</span>
                    <small>{project.cards ?? 0}</small>
                  </button>
                ))}
              </nav>
            </>
          )}
          <div className="sidebar-account">
            {guestMode ? (
              <Button
                className="sidebar-auth-button"
                icon="login"
                aria-label="Войти"
                aria-haspopup="dialog"
                disabled={busy}
                onClick={() => {
                  setAuthError('');
                  setMode('login');
                  setAuthOpen(true);
                }}
              >
                <span className="sidebar-label">Войти</span>
              </Button>
            ) : (
              <>
                <span className="avatar" aria-hidden="true">
                  {user.email.charAt(0).toUpperCase()}
                </span>
                <span className="sidebar-email" title={user.email}>
                  {user.email}
                </span>
                <button className="icon-button" disabled={busy} aria-label="Выйти" onClick={logout}>
                  ↪
                </button>
              </>
            )}
          </div>
          {!panels.collapsed && (
            <PanelDivider
              side="left"
              label="Ширина левой панели"
              width={panels.left}
              min={176}
              max={410}
              resize={(left) => setPanels((current) => ({ ...current, left }))}
            />
          )}
        </aside>
        <main className="workspace">
          <header className="workspace-header">
            <div className="workspace-header-main">
              <div className="workspace-heading" inert={searchOpen && !guestMode}>
                {folder !== null && active && (
                  <nav className="board-breadcrumbs" aria-label="Путь к папке">
                    <button
                      title={active.name}
                      onClick={() =>
                        navigate({ view: 'project', project: active.publicId ?? active.id })
                      }
                    >
                      {active.name}
                    </button>
                    <span aria-hidden="true">/</span>
                    {trail
                      .filter((item) => item.id !== folder)
                      .map((item) => (
                        <span key={item.id}>
                          <button
                            title={item.name}
                            onClick={() => enterFolder(item.publicId, active.id)}
                          >
                            {item.name}
                          </button>
                          <span aria-hidden="true">/</span>
                        </span>
                      ))}
                  </nav>
                )}
                {active && (folder === null || activeFolder) ? (
                  <WorkspaceTitle
                    key={activeFolder ? `folder-${activeFolder.id}` : `project-${active.id}`}
                    name={activeFolder?.name ?? active.name}
                    label={activeFolder ? 'Название папки' : 'Название проекта'}
                    save={(name) => renameTitle(active, activeFolder, name)}
                  />
                ) : (
                  <h1>{active?.name ?? names[route.view]}</h1>
                )}
              </div>
              {!guestMode && (
                <div className="workspace-search">
                  <IconButton
                    ref={searchButton}
                    icon="search"
                    iconSize={20}
                    label="Поиск"
                    aria-expanded={searchOpen}
                    aria-keyshortcuts="Meta+K Control+K"
                    aria-controls={searchOpen ? 'memo-search' : undefined}
                    hidden={searchOpen}
                    onClick={openSearch}
                  />
                  {searchOpen && (
                    <div id="memo-search" role="search" className="workspace-search-field">
                      <input
                        autoFocus
                        ref={searchInput}
                        type="search"
                        maxLength={128}
                        aria-label="Поиск по всем записям"
                        placeholder="Найти · ⌘ / Ctrl K"
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          if (route.view !== 'search') navigate({ view: 'search' });
                        }}
                        onBlur={() => setSearchOpen(false)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          dismissSearch();
                        }}
                      />
                      <Icon name="search" size={18} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </header>
          <div className="project-toolbar">
            {showingProjects && (
              <Button
                ref={projectCreateButton}
                variant="primary"
                icon="plus"
                aria-haspopup="dialog"
                disabled={busy}
                onClick={() => {
                  setShortcutsOpen(false);
                  setProjectCreateOpen(true);
                }}
              >
                Создать проект
              </Button>
            )}
            {active && (
              <div className="board-add">
                <Button
                  ref={boardAddButton}
                  variant="primary"
                  icon="plus"
                  aria-label="Добавить на полотно"
                  disabled={busy || !loaded || loadedKey !== loadKey}
                  aria-expanded={boardAddOpen}
                  aria-controls={boardAddOpen ? 'board-add-actions' : undefined}
                  onClick={() => setBoardAddOpen((open) => !open)}
                >
                  Добавить
                </Button>
                {boardAddOpen && (
                  <Popover
                    id="board-add-actions"
                    className="board-add-popover"
                    role="region"
                    aria-label="Добавить на полотно"
                    trigger={boardAddButton}
                    onDismiss={() => setBoardAddOpen(false)}
                  >
                    {(
                      [
                        { icon: 'record', label: 'Запись', key: 'N' },
                        { icon: 'folder', label: 'Папка', key: 'F' },
                      ] as const
                    ).map(({ icon, label, key }) => (
                      <Button
                        key={icon}
                        variant="text"
                        icon={icon}
                        aria-keyshortcuts={`Alt+Shift+${key}`}
                        onClick={() => chooseAddAction(() => createBlock(icon))}
                      >
                        <span>{label}</span>
                        <kbd aria-hidden="true">Alt + Shift + {key}</kbd>
                      </Button>
                    ))}
                    {markTools.map(({ icon, shortLabel, key, kind }) => (
                      <Button
                        key={kind}
                        variant="text"
                        icon={icon}
                        aria-keyshortcuts={`Alt+Shift+${key}`}
                        onClick={() => chooseAddAction(() => draw(kind))}
                      >
                        <span>{shortLabel}</span>
                        <kbd aria-hidden="true">Alt + Shift + {key}</kbd>
                      </Button>
                    ))}
                  </Popover>
                )}
              </div>
            )}
            {active && (
              <div className="view-switch" role="group" aria-label="Вид проекта">
                <IconButton
                  label="Полотно"
                  tooltip="Полотно · Alt+Shift+B"
                  aria-keyshortcuts="Alt+Shift+B"
                  icon="board"
                  aria-pressed={viewMode === 'board'}
                  onClick={() => setViewMode('board')}
                />
                <IconButton
                  label="Список"
                  tooltip="Список · Alt+Shift+V"
                  aria-keyshortcuts="Alt+Shift+V"
                  icon="list"
                  aria-pressed={viewMode === 'list'}
                  onClick={() => setViewMode('list')}
                />
              </div>
            )}
            {!showingBoard && toasts && (
              <div className="memo-toast-stack toolbar-toasts">{toasts}</div>
            )}
          </div>
          {(showingProjects ? projectsStatus === 'loading' : loading || loadedKey !== loadKey) ? (
            <div className="loading-screen" role="status">
              {showingProjects ? 'Загружаем проекты…' : 'Загружаем записи…'}
            </div>
          ) : !(showingProjects ? projectsStatus === 'ready' : loaded) ? (
            <div className="loading-screen">
              <p>
                {recordRoute
                  ? 'Не удалось открыть запись.'
                  : showingProjects
                    ? 'Не удалось загрузить проекты.'
                    : 'Не удалось загрузить записи.'}
              </p>
              <button className="secondary" onClick={refresh}>
                Повторить загрузку
              </button>
            </div>
          ) : workspaceView ? (
            viewMode === 'board' ? (
              <Board
                key={`${user.id}:${selected}:${folder ?? 'root'}`}
                cards={cards}
                links={links}
                projectId={selected ?? 0}
                folderId={folder}
                drawingTool={drawingTool}
                consumeDrawingTool={() => setDrawingTool(null)}
                notifications={toasts}
                locate={locate}
                busy={busy || projectCreateOpen}
                keyboardDisabled={authOpen || shortcutsOpen || searchOpen}
                storageKey={`memo:${user.id}:camera:${selected}${folder === null ? '' : `:${folder}`}`}
                focusId={focusId}
                clipboard={boardClipboard}
                copy={(item) => {
                  pendingPaste.current = null;
                  setBoardClipboard(item);
                }}
                pasteCard={pasteCard}
                createBlock={createBlock}
                open={(card, edit) => openId(card.id, edit)}
                enter={(card) => enterFolder(card.publicId ?? card.id, card.project)}
                rename={renameCard}
                moveSelection={moveSelection}
                removeSelection={removeSelection}
                child={createChild}
                position={updatePosition}
                connect={connect}
                disconnect={disconnect}
                reconnect={reconnect}
                remove={remove}
              />
            ) : (
              <section className="library-panel">
                <CardList cards={cards} projects={projects} open={openFromList} locate={locate} />
                {!cards.length && <p className="empty-message">Здесь пока нет записей и папок.</p>}
              </section>
            )
          ) : showingProjects ? (
            <section className="library-panel">
              {visibleProjects.length ? (
                <ul className="project-list">
                  {visibleProjects.map((project) => (
                    <li key={project.id}>
                      <button
                        className="project-row"
                        disabled={busy}
                        onClick={() =>
                          navigate({ view: 'project', project: project.publicId ?? project.id })
                        }
                      >
                        <span className="project-row-name">{project.name}</span>
                        <span className="project-row-count">Записей: {project.cards ?? 0}</span>
                      </button>
                      <ProjectActions
                        project={project}
                        busy={busy}
                        exportProject={() => exportProject(project)}
                        deleteProject={() => requestDelete({ project })}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-message">У вас пока нет проектов.</p>
              )}
            </section>
          ) : route.view === 'trash' ? (
            <section className="library-panel">
              <p className="lead">
                Записи и проекты остаются здесь до восстановления. Связи сохраняются, потомки не
                удаляются.
              </p>
              {trash.projects.map((project) => (
                <article className="trash-row" key={`p:${project.id}`}>
                  <div>
                    <span className="record-project">ПРОЕКТ</span>
                    <h2>{project.name}</h2>
                    <p>{project.cards ?? 0} записей</p>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => restore(project.id, 'project')}
                  >
                    Восстановить проект
                  </button>
                </article>
              ))}
              {trash.cards.map((card) => (
                <article className="trash-row" key={`c:${card.id}`}>
                  <div>
                    <span className="record-project">
                      {card.kind === 'folder' ? 'ПАПКА' : 'ЗАПИСЬ'}
                    </span>
                    <h2>{card.name}</h2>
                    <p>{excerpt(card).slice(0, 180)}</p>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => restore(card.id, 'card')}
                  >
                    {card.kind === 'folder' ? 'Восстановить папку' : 'Восстановить запись'}
                  </button>
                </article>
              ))}
              {!trash.cards.length && !trash.projects.length && (
                <p className="empty-message">Корзина пуста.</p>
              )}
            </section>
          ) : route.view === 'drafts' ? (
            <section className="library-panel">
              <p className="lead">
                Несохранённый ввод на этом устройстве. При открытии Memo предложит восстановить его
                или сохранить отдельной записью.
              </p>
              {drafts.map((draft) => (
                <article className="trash-row" key={draft.card.id}>
                  <div>
                    <h2>{draft.card.name}</h2>
                    <p>{excerpt(draft.card).slice(0, 160)}</p>
                  </div>
                  <div className="button-row">
                    <button className="secondary" onClick={() => openId(draft.card.id, true)}>
                      Открыть черновик
                    </button>
                    <Button
                      variant="text"
                      className="danger"
                      onClick={() => requestDelete({ draft: draft.card })}
                    >
                      Удалить черновик
                    </Button>
                  </div>
                </article>
              ))}
              {!drafts.length && <p className="empty-message">Несохранённых черновиков нет.</p>}
            </section>
          ) : (
            <section className="library-panel">
              {route.view !== 'inbox' && (
                <p className="lead">
                  {route.view === 'search'
                    ? query
                      ? `Результаты по запросу «${query}»`
                      : 'Поиск по названиям, тексту и ссылкам во всех проектах.'
                    : 'Недавно открытые и новые записи.'}
                </p>
              )}
              <CardList
                cards={cards}
                projects={projects}
                query={query}
                open={openFromList}
                locate={locate}
              />
              {!cards.length && (
                <div className="empty-message">
                  <p>
                    {route.view === 'search'
                      ? 'Ничего не найдено. Попробуйте другое слово.'
                      : 'Здесь пока нет записей.'}
                  </p>
                </div>
              )}
              {hasMore && (
                <p className="help-text">Показаны первые 100 записей. Уточните запрос в поиске.</p>
              )}
            </section>
          )}
          <div className="workspace-shortcuts">
            <IconButton
              ref={shortcutsButton}
              icon="keyboard"
              iconSize={22}
              label="Сочетания клавиш"
              aria-expanded={shortcutsOpen}
              aria-controls={shortcutsOpen ? 'keyboard-shortcuts' : undefined}
              aria-keyshortcuts="Alt+Shift+H"
              onClick={() => setShortcutsOpen((open) => !open)}
            />
            {shortcutsOpen && (
              <Popover
                id="keyboard-shortcuts"
                className="shortcuts-panel"
                role="region"
                aria-labelledby="shortcuts-title"
                trigger={shortcutsButton}
                onDismiss={() => setShortcutsOpen(false)}
              >
                <h2 id="shortcuts-title">Сочетания клавиш</h2>
                <dl className="shortcut-list">
                  {shortcutHelp.map(([action, keys]) => (
                    <div key={action}>
                      <dt>{action}</dt>
                      <dd>
                        <kbd>{keys}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </Popover>
            )}
          </div>
        </main>
        {editing && (
          <div className="record-dock">
            <PanelDivider
              side="right"
              label="Ширина панели записи"
              width={panels.right}
              min={270}
              max={690}
              resize={(right) => setPanels((current) => ({ ...current, right }))}
            />
            <CardEditor
              key={`${user.id}:${editing.id}`}
              card={editing}
              userId={user.id}
              initiallyEditing={openForEditing}
              close={() => setEditing(null)}
              saved={replaceCard}
              deleted={(card) => {
                setEditing(null);
                if (recordRoute && recordRoute.record === card.publicId && boardRoute)
                  navigate(boardRoute);
                setDeletedItem({ id: card.id, type: 'card' });
                setNotice(
                  card.kind === 'folder'
                    ? 'Папка перемещена в корзину.'
                    : 'Запись перемещена в корзину.',
                );
                refresh();
              }}
              copied={(card) => {
                setOpenForEditing(true);
                setEditing(card);
                refresh();
              }}
            />
          </div>
        )}
      </div>
      {authOpen && (
        <GuestAuthDialog
          mode={mode}
          changeMode={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setAuthError('');
          }}
          busy={busy}
          transferring={transfer !== null}
          error={authError}
          dismiss={() => setAuthOpen(false)}
          authenticate={authenticate}
          retry={() => {
            if (transfer) runAuth(() => importWorkspace(transfer));
          }}
        />
      )}
      {projectCreateOpen && (
        <ProjectCreateDialog create={createProject} dismiss={dismissProjectCreate} />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={'project' in confirmDelete ? 'Переместить проект в корзину?' : 'Удалить черновик?'}
          description={
            'project' in confirmDelete
              ? 'Проект, записи и связи можно будет восстановить из корзины.'
              : 'Удалится черновик на этом устройстве. Запись на сервере сохранится.'
          }
          action={'project' in confirmDelete ? 'В корзину' : 'Удалить'}
          icon="trash"
          busy={busy}
          error={deleteError}
          dismiss={() => setConfirmDelete(null)}
          confirm={deleteConfirmed}
        />
      )}
    </WorkspaceClient.Provider>
  );
}
