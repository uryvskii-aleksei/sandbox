import type { JSONContent } from '@tiptap/core';

export type MemoDocument = JSONContent & { type: 'doc'; content: JSONContent[] };

export interface User {
  id: number;
  email: string;
}
export interface Session {
  user: User | null;
  csrfToken: string;
}
export interface Project {
  id: number;
  name: string;
  cards?: number;
  inbox?: boolean;
  deletedAt?: string | null;
}
export const fieldTypes = ['textarea', 'url', 'date', 'image', 'video', 'audio'] as const;
export type FieldType = (typeof fieldTypes)[number];
export interface Field {
  id: number;
  type: FieldType;
  title: string;
  order: number;
  value: string[];
}
export interface FieldGroup {
  id: number;
  name: string;
  order: number;
  collapsed: boolean;
  fields: Field[];
}
export interface Card {
  id: number;
  project: number;
  name: string;
  parent: number | null;
  kind?: 'record' | 'folder';
  folder?: number | null;
  coordinates: { x: number; y: number };
  size?: { width: number; height: number };
  version: number;
  content: FieldGroup[];
  document?: MemoDocument;
  pinned?: boolean;
  deletedAt?: string | null;
  updatedAt?: string | null;
  openedAt?: string | null;
}
// Существующий тип square хранит и квадраты, и прямоугольники.
export type SketchKind = 'line' | 'square' | 'circle';
export interface Sketch {
  kind: SketchKind;
  at: Card['coordinates'];
  end: Card['coordinates'];
  text?: string;
}
export type NewBoardMark =
  { kind: 'label'; at: Card['coordinates']; text: string; scale?: number } | Sketch;
export type BoardMark = NewBoardMark & { id: number };
export type BoardClipboard = { cardId: number } | { mark: NewBoardMark };
export interface BoardMarkUpdate {
  at?: Card['coordinates'];
  end?: Card['coordinates'];
  text?: string;
  scale?: number;
}
export interface BoardSelection {
  cards: number[];
  marks: number[];
}
export type BoardMove = { destination: number } | { offset: Card['coordinates'] };
export interface Folder {
  id: number;
  name: string;
  folder: number | null;
}

export function folderTrail(folders: Folder[], id: number | null): Folder[] {
  const trail: Folder[] = [];
  const seen = new Set<number>();
  while (id !== null && !seen.has(id)) {
    const folder = folders.find((item) => item.id === id);
    if (!folder) break;
    seen.add(id);
    trail.push(folder);
    id = folder.folder;
  }
  return trail.reverse();
}
export interface CardLink {
  source: number;
  target: number;
  label: string;
  sourceName: string;
  targetName: string;
  sourceProject: number;
  targetProject: number;
}
export interface SearchResult {
  cards: Card[];
  hasMore: boolean;
}
export interface Trash {
  cards: Card[];
  projects: Project[];
}
export type Template = 'blank' | 'family' | 'outline' | 'retro' | 'tasks';
export interface LinkPreview {
  title: string;
  description: string;
  image: string;
  link: string;
}
export const labels: Record<FieldType, string> = {
  textarea: 'Текст',
  url: 'Ссылка',
  date: 'Дата',
  image: 'Изображение',
  video: 'Видео',
  audio: 'Аудио',
};

export function moveItem<T>(values: T[], index: number, offset: number): T[] {
  const destination = index + offset;
  if (destination < 0 || destination >= values.length) return values;
  const result = [...values];
  const [item] = result.splice(index, 1);
  result.splice(destination, 0, item);
  return result;
}

export function safeUrl(value: string): string {
  if (/[\\\x00-\x20]/.test(value)) return '';
  if (/^\/(?!\/)/.test(value)) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
