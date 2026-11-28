import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api';
import type { Project } from './types';
import { Button, IconButton, Modal } from './ui';

export function ProjectInviteDialog({
  project,
  dismiss,
  sent,
}: {
  project: Project;
  dismiss: () => void;
  sent: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const email = String(new FormData(event.currentTarget).get('email')).trim();
    setBusy(true);
    setError('');
    try {
      await api.invite(project.id, email);
      sent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отправить приглашение.');
      setBusy(false);
    }
  };
  return (
    <Modal
      className="guest-auth project-invite-dialog"
      aria-labelledby="project-invite-title"
      initialFocus={input}
      locked={busy}
      dismiss={dismiss}
    >
      <IconButton
        className="guest-auth-close"
        icon="close"
        label="Закрыть"
        disabled={busy}
        onClick={dismiss}
      />
      <section className="auth-form">
        <h2 id="project-invite-title">Пригласить в проект</h2>
        <p>Получатель сможет редактировать карточки и полотно проекта «{project.name}».</p>
        <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
          <label>
            Email
            <input
              ref={input}
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              readOnly={busy}
            />
          </label>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Отправляем…' : 'Отправить приглашение'}
          </Button>
        </form>
      </section>
    </Modal>
  );
}
