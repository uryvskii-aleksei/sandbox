import { useRef } from 'react';
import type { FormEvent } from 'react';
import { Button, IconButton, Modal } from './ui';

export function GuestAuthDialog({
  mode,
  changeMode,
  busy,
  transferring,
  error,
  dismiss,
  authenticate,
  retry,
}: {
  mode: 'login' | 'register';
  changeMode: () => void;
  busy: boolean;
  transferring: boolean;
  error: string;
  dismiss: () => void;
  authenticate: (event: FormEvent<HTMLFormElement>) => void;
  retry: () => void;
}) {
  const email = useRef<HTMLInputElement>(null);
  return (
    <Modal
      className="guest-auth"
      aria-labelledby="guest-auth-title"
      locked={busy || transferring}
      initialFocus={email}
      dismiss={dismiss}
    >
      <header>
        <h2 id="guest-auth-title">
          {transferring
            ? 'Сохранение полотна'
            : mode === 'login'
              ? 'Войти в Memo'
              : 'Создать аккаунт'}
        </h2>
        {!transferring && (
          <IconButton icon="close" label="Закрыть" disabled={busy} onClick={dismiss} />
        )}
      </header>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {transferring ? (
        <Button variant="primary" disabled={busy} onClick={retry}>
          {busy ? 'Сохраняем…' : 'Повторить перенос'}
        </Button>
      ) : (
        <>
          <form onSubmit={authenticate}>
            <label>
              {import.meta.env.DEV && mode === 'login' ? 'Email или логин' : 'Email'}
              <input
                ref={email}
                name="email"
                type={import.meta.env.DEV && mode === 'login' ? 'text' : 'email'}
                autoComplete={mode === 'login' ? 'username' : 'email'}
                required
                maxLength={254}
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={72}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
            </Button>
          </form>
          <Button variant="text" disabled={busy} onClick={changeMode}>
            {mode === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт'}
          </Button>
        </>
      )}
    </Modal>
  );
}
