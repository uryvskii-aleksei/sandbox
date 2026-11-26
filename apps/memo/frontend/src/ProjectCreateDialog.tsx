import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Template } from './types';
import { Button, Modal, Select } from './ui';

const templates: { value: Template; label: string }[] = [
  { value: 'blank', label: 'Пустой проект' },
  { value: 'family', label: 'Семейное дерево' },
  { value: 'outline', label: 'Конспект по теме' },
  { value: 'retro', label: 'Ретроспектива' },
  { value: 'tasks', label: 'Трекер задач' },
];

export function ProjectCreateDialog({
  create,
  dismiss,
}: {
  create: (name: string, template: Template, requestId: string) => Promise<void>;
  dismiss: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ name: string; template: Template; requestId: string }>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = name.trim();
    if (busy || !title) return;
    const selected = new FormData(event.currentTarget).get('template');
    const template = templates.find(({ value }) => value === selected)?.value ?? 'blank';
    if (attempt.current?.name !== title || attempt.current.template !== template) {
      attempt.current = { name: title, template, requestId: crypto.randomUUID() };
    }
    setBusy(true);
    setError('');
    try {
      await create(title, template, attempt.current.requestId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать проект.');
      setBusy(false);
    }
  };

  return (
    <Modal
      className="project-create-dialog"
      aria-labelledby="project-create-title"
      initialFocus={input}
      locked={busy}
      dismiss={dismiss}
    >
      <h2 id="project-create-title">Создать проект</h2>
      <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <label>
          Название проекта
          <input
            ref={input}
            required
            maxLength={128}
            value={name}
            readOnly={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Select label="Начать с шаблона" name="template" defaultValue="blank" disabled={busy}>
          {templates.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="project-create-actions">
          <Button disabled={busy} onClick={dismiss}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? 'Создаём…' : 'Создать проект'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
