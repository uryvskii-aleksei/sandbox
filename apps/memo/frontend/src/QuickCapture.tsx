import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { quickContent } from './graph';
import { readLocal, removeLocal, writeLocal } from './storage';
import { safeUrl } from './types';
import type { Card, LinkPreview, Project } from './types';
import { Button, ConfirmDialog, IconButton, Modal, Select } from './ui';

interface QuickAttempt {
  requestId: string;
  text: string;
  name: string;
  url: string;
  project?: number;
  folder?: number;
}
function storedAttempt(value: unknown): value is QuickAttempt {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'text' in value &&
    typeof value.text === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'url' in value &&
    typeof value.url === 'string' &&
    (!('folder' in value) || typeof value.folder === 'number') &&
    (!('project' in value) || typeof value.project === 'number')
  );
}
export function QuickCapture({
  userId,
  projects,
  saved,
  close,
}: {
  userId: number;
  projects: Project[];
  saved: (card: Card) => void;
  close: () => void;
}) {
  const key = `memo:${userId}:quick`;
  const stored = readLocal(key);
  const initialText =
    typeof stored === 'object' &&
    stored !== null &&
    'text' in stored &&
    typeof stored.text === 'string'
      ? stored.text
      : '';
  const initialAttempt =
    typeof stored === 'object' &&
    stored !== null &&
    'attempt' in stored &&
    storedAttempt(stored.attempt)
      ? stored.attempt
      : undefined;
  const [text, setText] = useState(initialText);
  const [destination, setDestination] = useState('');
  const [attempt, setAttempt] = useState<QuickAttempt | undefined>(initialAttempt);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [localFailure, setLocalFailure] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const url =
    /^https?:\/\//i.test(text.trim()) && safeUrl(text.trim()) && !/\s/.test(text.trim())
      ? text.trim()
      : '';
  useEffect(() => {
    setPreview(null);
    if (!url) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      void api
        .preview(url)
        .then((result) => {
          if (live) setPreview(result);
        })
        .catch(() => {
          // Недоступное превью не мешает сохранить исходную ссылку.
        })
        .finally(() => {
          if (live) setPreviewLoading(false);
        });
    }, 500);
    return () => {
      live = false;
      window.clearTimeout(timer);
      setPreviewLoading(false);
    };
  }, [url]);
  useEffect(() => {
    setLocalFailure(!writeLocal(key, { text, attempt }));
  }, [text, attempt, key]);
  const closeDialog = () => {
    if (busy) return;
    const ok = writeLocal(key, { text, attempt });
    if (text && !ok) setConfirmDiscard(true);
    else close();
  };
  const submit = async () => {
    if (busy || !text.trim()) return;
    const operation = attempt ?? {
      requestId: crypto.randomUUID(),
      text: text.trim(),
      name: [...(preview?.title || text.trim().split('\n')[0])].slice(0, 128).join(''),
      url,
      ...(destination ? { project: Number(destination) } : {}),
    };
    setAttempt(operation);
    setBusy(true);
    setError('');
    writeLocal(key, { text, attempt: operation });
    try {
      const result = await api.capture({
        requestId: operation.requestId,
        text: operation.text,
        name: operation.name,
        project: operation.project,
        folder: operation.folder,
        content: quickContent(operation.text, operation.url),
      });
      removeLocal(key);
      saved(result);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500)
        setAttempt(undefined);
      setError(
        reason instanceof ApiError
          ? reason.message
          : 'Сервер не подтвердил сохранение. Повторите запрос: та же запись не будет создана дважды.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Modal
        className="capture-dialog"
        aria-labelledby="capture-title"
        locked={busy}
        initialFocus={input}
        dismiss={closeDialog}
      >
        <header>
          <div>
            <p className="eyebrow">ПОЙМАТЬ МЫСЛЬ · ALT+N</p>
            <h2 id="capture-title">Быстрая запись</h2>
          </div>
          <IconButton
            id="close-capture"
            label="Закрыть быструю запись"
            icon="close"
            disabled={busy}
            onClick={closeDialog}
          />
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Мысль или ссылка
            <textarea
              ref={input}
              rows={6}
              maxLength={20000}
              value={text}
              disabled={busy || !!attempt}
              placeholder="Запишите сейчас, разберёте позже…"
              required
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </label>
          <Select
            label="Куда сохранить"
            value={
              attempt
                ? attempt.folder !== undefined
                  ? `folder:${attempt.folder}`
                  : attempt.project === undefined
                    ? ''
                    : String(attempt.project)
                : destination
            }
            disabled={busy || !!attempt}
            onChange={(event) => setDestination(event.target.value)}
          >
            <option value="">Входящие</option>
            {attempt?.folder !== undefined && (
              <option value={`folder:${attempt.folder}`}>Папка из сохранённого запроса</option>
            )}
            {projects
              .filter((item) => !item.inbox)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </Select>
          {previewLoading && (
            <p className="help-text" role="status">
              Загружаем превью. Ссылку уже можно сохранить.
            </p>
          )}
          {preview && (
            <div className="link-preview">
              <strong>{preview.title}</strong>
              <p>{preview.description}</p>
            </div>
          )}
          {localFailure && (
            <p className="alert" role="alert">
              Черновик не сохраняется на устройстве. Дождитесь сохранения на сервере.
            </p>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <Button variant="primary" type="submit" disabled={busy || !text.trim()}>
              {busy ? 'Сохраняем…' : attempt ? 'Повторить сохранение' : 'Сохранить запись'}
            </Button>
            <span className="help-text">⌘ / Ctrl + Enter</span>
          </div>
        </form>
      </Modal>
      {confirmDiscard && (
        <ConfirmDialog
          title="Закрыть без сохранения?"
          description="Черновик недоступен. Введённый текст будет потерян."
          action="Закрыть"
          dismiss={() => setConfirmDiscard(false)}
          confirm={close}
        />
      )}
    </>
  );
}
