import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { routeUrl } from './routes';
import { Button } from './ui';

export function EmailLinkPage() {
  const base = import.meta.env.BASE_URL;
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token'));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<ReturnType<typeof api.redeemEmailLink> | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    let started = false;
    const open = () => {
      if (started || document.visibilityState !== 'visible') return;
      started = true;
      pending.current ??= api.session().then(() => api.redeemEmailLink(token));
      void pending.current.then(
        ({ project }) => {
          if (!live) return;
          location.replace(project ? routeUrl(base, { view: 'project', project }) : base);
        },
        (reason: unknown) => {
          if (live)
            setError(reason instanceof Error ? reason.message : 'Не удалось открыть ссылку.');
        },
      );
    };
    document.addEventListener('visibilitychange', open);
    open();
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', open);
    };
  }, [attempt, base, token]);

  return (
    <main className="email-link-page">
      <section className="auth-form">
        <span className="brand-mark">memo</span>
        <h1>Вход в Memo</h1>
        {token && !error ? (
          <p role="status">Открываем Memo…</p>
        ) : (
          <>
            <p role="alert" className="alert">
              {error || 'В письме должна быть полная ссылка.'}
            </p>
            <div className="project-create-actions">
              {token && (
                <Button
                  variant="primary"
                  onClick={() => {
                    pending.current = null;
                    setError('');
                    setAttempt((previous) => previous + 1);
                  }}
                >
                  Повторить
                </Button>
              )}
              <a href={base}>На главную Memo</a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
