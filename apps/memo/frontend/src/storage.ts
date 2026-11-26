import { isCard } from './api';
import type { Card } from './types';

export interface SaveAttempt {
  card: Card;
  requestId: string;
}
export interface Draft {
  card: Card;
  attempt?: SaveAttempt;
  savedAt: number;
}
export const guestUserId = 0;
const guestStorage = new Map<string, string>();
const isGuestKey = (key: string) => key.startsWith(`memo:${guestUserId}:`);
export const clearGuestStorage = () => guestStorage.clear();

export function readLocal(key: string): unknown {
  try {
    return JSON.parse(
      (isGuestKey(key) ? guestStorage.get(key) : localStorage.getItem(key)) ?? 'null',
    );
  } catch {
    return null;
  }
}
export function writeLocal(key: string, value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    if (isGuestKey(key)) guestStorage.set(key, serialized);
    else localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}
export function removeLocal(key: string): void {
  try {
    if (isGuestKey(key)) guestStorage.delete(key);
    else localStorage.removeItem(key);
  } catch {
    /* Хранилище может быть недоступно. */
  }
}
export const draftKey = (user: number, card: number) => `memo:${user}:draft:${card}`;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function readDraft(user: number, card: number): Draft | null {
  const value = readLocal(draftKey(user, card));
  if (
    !isRecord(value) ||
    !isCard(value.card) ||
    value.card.id !== card ||
    typeof value.savedAt !== 'number'
  )
    return null;
  const attempt = value.attempt;
  if (
    attempt !== undefined &&
    (!isRecord(attempt) ||
      !isCard(attempt.card) ||
      attempt.card.id !== card ||
      typeof attempt.requestId !== 'string')
  )
    return null;
  return {
    card: value.card,
    savedAt: value.savedAt,
    attempt:
      isRecord(attempt) && isCard(attempt.card) && typeof attempt.requestId === 'string'
        ? { card: attempt.card, requestId: attempt.requestId }
        : undefined,
  };
}
export function listDrafts(user: number): Draft[] {
  const result: Draft[] = [];
  if (user === guestUserId) return result;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(`memo:${user}:draft:`)) continue;
      const draft = readDraft(user, Number(key.split(':').at(-1)));
      if (draft) result.push(draft);
    }
  } catch {
    /* Список остаётся пустым при недоступном хранилище. */
  }
  return result.sort((a, b) => b.savedAt - a.savedAt);
}
