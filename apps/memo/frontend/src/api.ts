import { fieldTypes } from './types';
import type {
  Card,
  CardLink,
  BoardMark,
  BoardMarkUpdate,
  BoardMove,
  NewBoardMark,
  MemoDocument,
  Field,
  FieldGroup,
  Folder,
  LinkPreview,
  Project,
  SearchResult,
  Session,
  Template,
  Trash,
  User,
} from './types';

const base = `${import.meta.env.BASE_URL}api`;
export function resolveMediaUrl(value: string): string {
  const uploaded = value.match(/^\/(?:[a-zA-Z0-9_-]+\/)*api\/media\/([a-f0-9]{32})$/);
  return uploaded ? `${base}/media/${uploaded[1]}` : value;
}
const hotCsrf: unknown = import.meta.hot?.data.csrfToken;
let csrfToken = typeof hotCsrf === 'string' ? hotCsrf : '';
import.meta.hot?.dispose((data) => {
  data.csrfToken = csrfToken;
});
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const point = (value: unknown): value is Card['coordinates'] =>
  record(value) && number(value.x) && number(value.y);
const isDocument = (value: unknown): value is MemoDocument =>
  record(value) && value.type === 'doc' && Array.isArray(value.content);
const isMark = (value: unknown): value is BoardMark =>
  record(value) &&
  number(value.id) &&
  point(value.at) &&
  ((value.kind === 'label' &&
    typeof value.text === 'string' &&
    (value.scale === undefined || number(value.scale))) ||
    ((value.kind === 'line' || value.kind === 'square' || value.kind === 'circle') &&
      point(value.end) &&
      (value.text === undefined || typeof value.text === 'string')));
const isUser = (value: unknown): value is User =>
  record(value) && number(value.id) && typeof value.email === 'string';
const isSession = (value: unknown): value is Session =>
  record(value) &&
  (value.user === null || isUser(value.user)) &&
  typeof value.csrfToken === 'string';
const isProject = (value: unknown): value is Project =>
  record(value) &&
  number(value.id) &&
  typeof value.name === 'string' &&
  (value.cards === undefined || number(value.cards)) &&
  (value.inbox === undefined || typeof value.inbox === 'boolean') &&
  (value.deletedAt === undefined ||
    value.deletedAt === null ||
    typeof value.deletedAt === 'string');
const isFolder = (value: unknown): value is Folder =>
  record(value) &&
  number(value.id) &&
  typeof value.name === 'string' &&
  (value.folder === null || number(value.folder));
const isField = (value: unknown): value is Field =>
  record(value) &&
  number(value.id) &&
  typeof value.type === 'string' &&
  fieldTypes.some((type) => type === value.type) &&
  typeof value.title === 'string' &&
  number(value.order) &&
  Array.isArray(value.value) &&
  value.value.every((item: unknown) => typeof item === 'string');
const isGroup = (value: unknown): value is FieldGroup =>
  record(value) &&
  number(value.id) &&
  typeof value.name === 'string' &&
  number(value.order) &&
  typeof value.collapsed === 'boolean' &&
  Array.isArray(value.fields) &&
  value.fields.every(isField);
export const isCard = (value: unknown): value is Card =>
  record(value) &&
  number(value.id) &&
  number(value.project) &&
  typeof value.name === 'string' &&
  (value.parent === null || number(value.parent)) &&
  (value.kind === undefined || value.kind === 'record' || value.kind === 'folder') &&
  (value.folder === undefined || value.folder === null || number(value.folder)) &&
  number(value.version) &&
  record(value.coordinates) &&
  number(value.coordinates.x) &&
  number(value.coordinates.y) &&
  Array.isArray(value.content) &&
  value.content.every(isGroup) &&
  (value.size === undefined ||
    (record(value.size) && number(value.size.width) && number(value.size.height))) &&
  (value.document === undefined || isDocument(value.document)) &&
  (value.pinned === undefined || typeof value.pinned === 'boolean') &&
  ['deletedAt', 'updatedAt', 'openedAt'].every(
    (key) => value[key] === undefined || value[key] === null || typeof value[key] === 'string',
  );
const isLink = (value: unknown): value is CardLink =>
  record(value) &&
  number(value.source) &&
  number(value.target) &&
  typeof value.label === 'string' &&
  typeof value.sourceName === 'string' &&
  typeof value.targetName === 'string' &&
  number(value.sourceProject) &&
  number(value.targetProject);
const isSearch = (value: unknown): value is SearchResult =>
  record(value) &&
  Array.isArray(value.cards) &&
  value.cards.every(isCard) &&
  typeof value.hasMore === 'boolean';
const isTrash = (value: unknown): value is Trash =>
  record(value) &&
  Array.isArray(value.cards) &&
  value.cards.every(isCard) &&
  Array.isArray(value.projects) &&
  value.projects.every(isProject);
const isExport = (value: unknown): value is Record<string, unknown> =>
  record(value) &&
  value.format === 'memo-project' &&
  value.version === 1 &&
  isProject(value.project) &&
  Array.isArray(value.cards) &&
  value.cards.every(isCard) &&
  Array.isArray(value.links) &&
  value.links.every(isLink) &&
  Array.isArray(value.media);
const isPreview = (value: unknown): value is LinkPreview =>
  record(value) &&
  ['title', 'description', 'image', 'link'].every((key) => typeof value[key] === 'string');
const isUpload = (value: unknown): value is { url: string } =>
  record(value) && typeof value.url === 'string';
const isNull = (value: unknown): value is null => value === null;
const array =
  <T>(validate: (value: unknown) => value is T) =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(validate);

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  route: string,
  validate: (value: unknown) => value is T,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`${base}${route}`, {
    ...options,
    credentials: 'same-origin',
    signal: options.signal ?? AbortSignal.timeout(20000),
    headers,
  });
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (reason) {
    throw new Error('Сервер временно недоступен. Проверьте соединение и повторите запрос.', {
      cause: response.ok ? reason : undefined,
    });
  }
  if (!record(envelope)) throw new Error('Сервер вернул некорректный ответ.');
  if (!response.ok || envelope.ok !== true)
    throw new ApiError(
      typeof envelope.error === 'string' ? envelope.error : 'Не удалось выполнить запрос.',
      response.status,
    );
  if (!validate(envelope.data)) throw new Error('Формат ответа сервера изменился.');
  return envelope.data;
}

async function session(route: string, options?: RequestInit): Promise<Session> {
  const result = await request(route, isSession, options);
  csrfToken = result.csrfToken;
  return result;
}

export const api = {
  session: () => session('/session'),
  auth: (mode: 'login' | 'register', email: string, password: string) =>
    session(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => session('/auth/logout', { method: 'POST', body: '{}' }),
  projects: (signal?: AbortSignal) => request('/projects', array(isProject), { signal }),
  createProject: (name: string, template: Template, requestId: string) =>
    request('/projects', isProject, {
      method: 'POST',
      body: JSON.stringify({ name, template, requestId }),
    }),
  renameProject: (id: number, name: string) =>
    request(`/projects/${id}`, isProject, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteProject: (id: number) => request(`/projects/${id}`, isNull, { method: 'DELETE' }),
  cards: (project: number, folder: number | null, signal?: AbortSignal) =>
    request(`/projects/${project}/cards?folder=${folder ?? 'root'}`, array(isCard), { signal }),
  folders: (project: number, signal?: AbortSignal) =>
    request(`/projects/${project}/folders`, array(isFolder), { signal }),
  createCard: (project: number, parent: number | null, coordinates: Card['coordinates']) =>
    request(`/projects/${project}/cards`, isCard, {
      method: 'POST',
      body: JSON.stringify({ name: 'Новая мысль', parent, coordinates }),
    }),
  saveCard: (card: Card, requestId: string) => {
    const { parent: _parent, ...body } = card;
    return request(`/cards/${card.id}`, isCard, {
      method: 'PUT',
      body: JSON.stringify({
        ...body,
        ...(card.document ? { content: undefined } : {}),
        requestId,
      }),
    });
  },
  card: (id: number) => request(`/cards/${id}`, isCard),
  search: (query = '', filter = 'all', signal?: AbortSignal) =>
    request(
      `/search?q=${encodeURIComponent(query)}&filter=${encodeURIComponent(filter)}`,
      isSearch,
      { signal },
    ),
  links: (signal?: AbortSignal) => request('/links', array(isLink), { signal }),
  connect: (source: number, target: number, label = '') =>
    request('/links', isLink, {
      method: 'PUT',
      body: JSON.stringify({ source, target, label }),
    }),
  reconnectLink: async (link: CardLink, newSource: number, newTarget: number) => {
    const options: RequestInit = {
      method: 'PATCH',
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        source: link.source,
        target: link.target,
        newSource,
        newTarget,
      }),
    };
    try {
      return await request('/links', isLink, options);
    } catch (reason) {
      const failure = reason instanceof Error && reason.cause ? reason.cause : reason;
      if (
        !(failure instanceof TypeError) &&
        !(
          failure instanceof DOMException &&
          (failure.name === 'TimeoutError' || failure.name === 'NetworkError')
        )
      )
        throw reason;
      return request('/links', isLink, options);
    }
  },
  disconnect: (link: CardLink) =>
    request('/links', isNull, { method: 'DELETE', body: JSON.stringify(link) }),
  capture: (body: {
    requestId: string;
    name?: string;
    text?: string;
    project?: number;
    folder?: number;
    kind?: Card['kind'];
    parent?: number;
    content?: FieldGroup[];
    document?: MemoDocument;
    coordinates?: Card['coordinates'];
  }) => request('/capture', isCard, { method: 'POST', body: JSON.stringify(body) }),
  visit: (id: number) => request(`/cards/${id}/visit`, isCard, { method: 'POST', body: '{}' }),
  copyCard: (
    id: number,
    body: {
      requestId: string;
      project: number;
      folder: number | null;
      coordinates: Card['coordinates'];
    },
  ) => request(`/cards/${id}/copy`, isCard, { method: 'POST', body: JSON.stringify(body) }),
  moveSelection: (
    project: number,
    folder: number | null,
    cards: Card[],
    marks: number[],
    move: BoardMove,
  ) =>
    request(
      `/projects/${project}/move-selection`,
      (value): value is { cards: Card[]; marks: BoardMark[] } =>
        record(value) && array(isCard)(value.cards) && array(isMark)(value.marks),
      {
        method: 'POST',
        body: JSON.stringify({
          folder,
          cards: cards.map(({ id, version }) => ({ id, version })),
          marks,
          ...move,
          requestId: crypto.randomUUID(),
        }),
      },
    ),
  trash: () => request('/trash', isTrash),
  restoreCard: (id: number) =>
    request(`/cards/${id}/restore`, isCard, { method: 'POST', body: '{}' }),
  restoreProject: (id: number) =>
    request(`/projects/${id}/restore`, isProject, { method: 'POST', body: '{}' }),
  exportProject: (id: number) => request(`/projects/${id}/export`, isExport),
  position: (card: Card) =>
    request(`/cards/${card.id}/position`, isCard, {
      method: 'PATCH',
      body: JSON.stringify({
        coordinates: card.coordinates,
        size: card.size,
        version: card.version,
      }),
    }),
  deleteCard: (id: number) => request(`/cards/${id}`, isNull, { method: 'DELETE' }),
  marks: (project: number, folder: number | null, signal?: AbortSignal) =>
    request(`/projects/${project}/marks?folder=${folder ?? 'root'}`, array(isMark), { signal }),
  createMark: (project: number, folder: number | null, mark: NewBoardMark, requestId: string) =>
    request(`/projects/${project}/marks`, isMark, {
      method: 'POST',
      body: JSON.stringify({ ...mark, folder, requestId }),
    }),
  editMark: (id: number, patch: BoardMarkUpdate) =>
    request(`/marks/${id}`, isMark, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteMark: (id: number) => request(`/marks/${id}`, isNull, { method: 'DELETE' }),
  trashSelection: (
    project: number,
    folder: number | null,
    cards: number[],
    marks: number[],
    requestId: string,
  ) =>
    request(`/projects/${project}/trash-selection`, isNull, {
      method: 'POST',
      body: JSON.stringify({ folder, cards, marks, requestId }),
    }),
  preview: (url: string) =>
    request('/preview', isPreview, { method: 'POST', body: JSON.stringify({ url }) }),
  upload: (file: File) => {
    const body = new FormData();
    body.set('file', file);
    return request('/media', isUpload, { method: 'POST', body });
  },
};
