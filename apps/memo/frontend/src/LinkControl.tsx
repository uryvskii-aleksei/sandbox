import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CardLink } from './types';
import { IconButton } from './ui';

export function LinkControl({
  link,
  style,
  highlighted,
  dimmed,
  busy,
  save,
  remove,
  reassign,
}: {
  link: CardLink;
  style: CSSProperties;
  highlighted: boolean;
  dimmed: boolean;
  busy: boolean;
  save: (link: CardLink, label: string) => Promise<void>;
  remove: (link: CardLink) => Promise<void>;
  reassign: (moving: 'source' | 'target') => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(link.label);
  const [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const cancelling = useRef(false);
  const key = `edge-${link.source}:${link.target}`;
  const name = `${link.sourceName} → ${link.targetName}`;
  const commit = async () => {
    if (saving.current) return;
    if (label === link.label) {
      setEditing(false);
      return;
    }
    saving.current = true;
    setError('');
    try {
      await save(link, label);
      setEditing(false);
    } catch {
      setError('Не удалось сохранить подпись. Повторите ввод.');
    } finally {
      saving.current = false;
    }
  };
  return (
    <div
      className={`connection-control ${highlighted ? 'connection-hover' : ''} ${dimmed ? 'connection-muted' : ''} ${link.label ? 'connection-named' : ''}`}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {editing ? (
        <input
          autoFocus
          className="connection-input"
          aria-label={`Подпись связи ${name}`}
          placeholder="Название связи"
          maxLength={128}
          value={label}
          disabled={busy}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => {
            if (cancelling.current) cancelling.current = false;
            else void commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit();
            } else if (event.key === 'Escape') {
              event.stopPropagation();
              cancelling.current = true;
              setEditing(false);
              requestAnimationFrame(() => button.current?.focus());
            }
          }}
        />
      ) : (
        <button
          ref={button}
          id={key}
          className={`connection-label ${link.label ? '' : 'connection-empty'}`}
          aria-label={`Действия связи ${name}${link.label ? `: ${link.label}` : ''}`}
          aria-controls={`${key}-actions`}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          onKeyDown={(event) => {
            if (busy || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
            event.preventDefault();
            reassign(event.key === 'ArrowLeft' ? 'source' : 'target');
          }}
          title={link.label || 'Действия связи'}
        >
          {link.label}
        </button>
      )}
      {!editing && (
        <div
          className="connection-actions"
          id={`${key}-actions`}
          role="group"
          aria-label={`Действия связи ${name}`}
        >
          <IconButton
            label={`Изменить подпись связи ${name}`}
            icon="pencil"
            disabled={busy}
            onClick={() => {
              cancelling.current = false;
              setLabel(link.label);
              setError('');
              setEditing(true);
            }}
          />
          <IconButton
            label={`Удалить связь ${name}`}
            className="canvas-trash"
            icon="trash"
            disabled={busy}
            onClick={() => void remove(link).catch(() => setError('Не удалось удалить связь.'))}
          />
        </div>
      )}
      {error && (
        <span className="connection-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
