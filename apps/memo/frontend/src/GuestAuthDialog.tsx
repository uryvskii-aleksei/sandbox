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
  const close = useRef<HTMLButtonElement>(null);
  const login = mode === 'login';
  const alert = error && (
    <p className="alert" role="alert">
      {error}
    </p>
  );
  return (
    <Modal
      className={transferring ? 'guest-auth guest-auth-transferring' : 'guest-auth'}
      aria-labelledby="guest-auth-title"
      locked={busy || transferring}
      initialFocus={close}
      dismiss={dismiss}
    >
      {transferring ? (
        <>
          <h2 id="guest-auth-title">Сохранение полотна</h2>
          {alert}
          <Button variant="primary" disabled={busy} onClick={retry}>
            {busy ? 'Сохраняем…' : 'Повторить перенос'}
          </Button>
        </>
      ) : (
        <div className="guest-auth-layout">
          <IconButton
            ref={close}
            className="guest-auth-close"
            icon="close"
            label="Закрыть"
            disabled={busy}
            onClick={dismiss}
          />
          <section className="auth-intro">
            <span className="brand-mark">Memo</span>
            <h2>
              Дайте мыслям
              <br />
              своё пространство.
            </h2>
            <p>
              Собирайте заметки, стройте семейное дерево, связывайте темы и находите новые идеи.
            </p>
            <div className="auth-illustration" aria-hidden="true">
              <span>Первая идея</span>
              <i />
              <span>Новая связь</span>
              <i />
              <span>Большая картина</span>
            </div>
          </section>
          <section className="auth-form">
            <p className="eyebrow">ВАШЕ ПРОСТРАНСТВО</p>
            <h2 id="guest-auth-title">{login ? 'С возвращением' : 'Начнём с аккаунта'}</h2>
            <p>
              {login
                ? 'Войдите, чтобы продолжить работу с записями.'
                : 'Все проекты и материалы будут доступны только вам.'}
            </p>
            {alert}
            <form onSubmit={authenticate}>
              <label>
                {import.meta.env.DEV && login ? 'Email или логин' : 'Email'}
                <input
                  name="email"
                  type={import.meta.env.DEV && login ? 'text' : 'email'}
                  autoComplete={login ? 'username' : 'email'}
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
                  autoComplete={login ? 'current-password' : 'new-password'}
                />
              </label>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Подождите…' : login ? 'Войти в пространство' : 'Создать аккаунт'}
              </Button>
            </form>
            <Button variant="text" disabled={busy} onClick={changeMode}>
              {login ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
            </Button>
          </section>
        </div>
      )}
    </Modal>
  );
}
