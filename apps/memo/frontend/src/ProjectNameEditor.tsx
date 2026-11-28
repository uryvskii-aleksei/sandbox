import { useId, useRef, useState } from 'react';

export function ProjectNameEditor({
  name,
  save,
  finish,
}: {
  name?: string;
  save: (name: string) => Promise<void>;
  finish: (restoreFocus: boolean) => void;
}) {
  const [draft, setDraft] = useState(name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const errorId = useId();
  const commit = async (input: HTMLInputElement) => {
    if (pending.current) return;
    const next = input.value.trim();
    const focused = document.activeElement === input;
    if (next === name || (!next && name === undefined && !focused)) {
      finish(focused);
      return;
    }
    if (!next) {
      setError('Введите название проекта.');
      return;
    }
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await save(next);
      finish(document.activeElement === input);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить название.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <div className="sidebar-project-edit">
      <input
        autoFocus
        aria-label="Название проекта"
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        maxLength={128}
        placeholder="Название проекта"
        readOnly={saving}
        value={draft}
        onFocus={(event) => event.currentTarget.setSelectionRange(draft.length, draft.length)}
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
          } else if (event.key === 'Escape' && !pending.current) {
            event.preventDefault();
            finish(true);
          }
        }}
      />
      {error && (
        <span id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
