import { useId, useRef, useState } from 'react';
import type { Card } from './types';

export function CardTitleEditor({
  card,
  save,
  close,
}: {
  card: Card;
  save: (name: string) => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(card.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const errorId = useId();
  const finish = (input: HTMLInputElement) => {
    const article = input === document.activeElement ? input.closest('article') : null;
    close();
    if (article)
      requestAnimationFrame(() => article.querySelector<HTMLButtonElement>('.card-title')?.focus());
  };
  const commit = async (input: HTMLInputElement) => {
    if (pending.current) return;
    const next = input.value.trim();
    if (!next) {
      setError('Введите название.');
      return;
    }
    if (next === card.name) {
      finish(input);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await save(next);
      finish(input);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить название.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <div className="card-title-draft">
      <input
        autoFocus
        className="card-title-input"
        aria-label={card.kind === 'folder' ? 'Название папки' : 'Название записи'}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        maxLength={128}
        readOnly={saving}
        value={draft}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.target.value);
          setError('');
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onBlur={(event) => void commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit(event.currentTarget);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            if (!pending.current) finish(event.currentTarget);
          }
        }}
      />
      {error && (
        <span className="card-title-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
