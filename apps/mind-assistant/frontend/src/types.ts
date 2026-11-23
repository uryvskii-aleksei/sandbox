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
  coordinates: { x: number; y: number };
  version: number;
  content: FieldGroup[];
}
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
