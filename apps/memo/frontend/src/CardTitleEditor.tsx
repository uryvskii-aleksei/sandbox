import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Card } from './types';

type CardSize = NonNullable<Card['size']>;

export function CardTitleFit({
  text,
  size: { width, height },
  children,
}: {
  text: string;
  size: CardSize;
  children: ReactNode;
}) {
  const mirror = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const probe = mirror.current;
    const container = probe?.parentElement;
    if (!probe || !container) return;

    const available = container.clientHeight;
    let minimum = 11;
    let maximum = 28;
    while (minimum < maximum) {
      const font = Math.ceil((minimum + maximum) / 2);
      probe.style.fontSize = `${font}px`;
      if (probe.offsetHeight <= available) minimum = font;
      else maximum = font - 1;
    }

    probe.style.fontSize = `${minimum}px`;
    const lineHeight = Number.parseFloat(getComputedStyle(probe).lineHeight);
    container.style.setProperty('--card-title-font-size', `${minimum}px`);
    container.style.setProperty(
      '--card-title-text-height',
      `${Math.min(available, probe.offsetHeight)}px`,
    );
    container.style.setProperty(
      '--card-title-lines',
      String(Math.max(1, Math.floor(available / lineHeight))),
    );
  }, [text, width, height]);

  return (
    <div className="card-title-fit">
      <span ref={mirror} className="card-title-mirror" aria-hidden="true">
        {!text || text.endsWith('\n') ? text + '\u200b' : text}
      </span>
      {children}
    </div>
  );
}

export function CardTitleEditor({
  card,
  size,
  initialText = card.name,
  selectText = false,
  save,
  close,
}: {
  card: Card;
  size: CardSize;
  initialText?: string;
  selectText?: boolean;
  save: (name: string) => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const errorId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    field.current?.focus({ preventScroll: true });
    if (selectText) field.current?.select();
    else field.current?.setSelectionRange(initialText.length, initialText.length);
  }, [initialText, selectText]);
  const finish = (input: HTMLTextAreaElement) => {
    const article = input === document.activeElement ? input.closest('article') : null;
    close();
    if (article)
      requestAnimationFrame(() => article.querySelector<HTMLButtonElement>('.card-title')?.focus());
  };
  const commit = async (input: HTMLTextAreaElement) => {
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
    <CardTitleFit text={draft} size={size}>
      <textarea
        ref={field}
        rows={1}
        className="card-title-input"
        aria-label={card.kind === 'folder' ? 'Название папки' : 'Название записи'}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        maxLength={128}
        readOnly={saving}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError('');
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onBlur={(event) => void commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
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
    </CardTitleFit>
  );
}
