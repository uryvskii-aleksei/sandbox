import { fieldTypes } from './types';
import type { Card, Field, FieldGroup, LinkPreview, Project, Session, User } from './types';

const base = `${import.meta.env.BASE_URL}api`;
let csrfToken = '';
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
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
  (value.cards === undefined || number(value.cards));
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
const isCard = (value: unknown): value is Card =>
  record(value) &&
  number(value.id) &&
  number(value.project) &&
  typeof value.name === 'string' &&
  (value.parent === null || number(value.parent)) &&
  number(value.version) &&
  record(value.coordinates) &&
  number(value.coordinates.x) &&
  number(value.coordinates.y) &&
  Array.isArray(value.content) &&
  value.content.every(isGroup);
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
    headers,
  });
  const envelope: unknown = await response.json();
  if (!record(envelope)) throw new Error('Сервер вернул некорректный ответ.');
  if (!response.ok || envelope.ok !== true)
    throw new Error(
      typeof envelope.error === 'string' ? envelope.error : 'Не удалось выполнить запрос.',
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
  createProject: (name: string) =>
    request('/projects', isProject, { method: 'POST', body: JSON.stringify({ name }) }),
  renameProject: (id: number, name: string) =>
    request(`/projects/${id}`, isProject, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteProject: (id: number) => request(`/projects/${id}`, isNull, { method: 'DELETE' }),
  cards: (project: number, signal?: AbortSignal) =>
    request(`/projects/${project}/cards`, array(isCard), { signal }),
  createCard: (project: number, parent: number | null, coordinates: Card['coordinates']) =>
    request(`/projects/${project}/cards`, isCard, {
      method: 'POST',
      body: JSON.stringify({ name: 'Новая мысль', parent, coordinates }),
    }),
  saveCard: (card: Card) =>
    request(`/cards/${card.id}`, isCard, { method: 'PUT', body: JSON.stringify(card) }),
  position: (card: Card) =>
    request(`/cards/${card.id}/position`, isCard, {
      method: 'PATCH',
      body: JSON.stringify({ coordinates: card.coordinates, version: card.version }),
    }),
  deleteCard: (id: number) => request(`/cards/${id}`, isNull, { method: 'DELETE' }),
  preview: (url: string) =>
    request('/preview', isPreview, { method: 'POST', body: JSON.stringify({ url }) }),
  upload: (file: File) => {
    const body = new FormData();
    body.set('file', file);
    return request('/media', isUpload, { method: 'POST', body });
  },
};
