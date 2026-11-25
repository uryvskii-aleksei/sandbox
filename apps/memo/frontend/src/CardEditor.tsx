import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { RichEditor } from './RichEditor';
import { recordSections, sectionDocument } from './document';
import type { RecordSection } from './document';
import { RecordContent } from './RecordContent';
import { contentSignature, copiedContent, excerpt, reconcileSaved } from './graph';
import { draftKey, readDraft, removeLocal, writeLocal } from './storage';
import { TrashDialog } from './TrashDialog';
import type { Draft, SaveAttempt } from './storage';
import type { Card } from './types';
import { Button, IconButton } from './ui';

interface Props {
  card: Card;
  userId: number;
  initiallyEditing: boolean;
  close: () => void;
  saved: (card: Card) => void;
  deleted: (card: Card) => void;
  copied: (card: Card) => void;
}
const reasonText = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Не удалось выполнить действие.';

export function CardEditor({
  card,
  userId,
  initiallyEditing,
  close,
  saved,
  deleted,
  copied,
}: Props) {
  const [editing, setEditing] = useState(initiallyEditing);
  const [edit, renderEdit] = useState(() => structuredClone(card));
  const editRef = useRef(edit);
  editRef.current = edit;
  const base = useRef(card);
  const [recovery, setRecovery] = useState<Draft | null>(() => {
    const draft = readDraft(userId, card.id);
    return draft && (draft.attempt || contentSignature(draft.card) !== contentSignature(card))
      ? draft
      : null;
  });
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error' | 'conflict'>(
    'saved',
  );
  const [error, setError] = useState('');
  const [localFailure, setLocalFailure] = useState(false);
  const [fieldPending, setFieldPending] = useState(0);
  const [working, setWorking] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const saving = useRef(false);
  const attempt = useRef<SaveAttempt | undefined>(undefined);
  const heading = useRef<HTMLInputElement>(null);
  const newSection = useRef<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const sections = useMemo(() => recordSections(edit), [edit.document, edit.content]);
  const editButton = useRef<HTMLButtonElement>(null);
  const copyKey = useRef(`draft-copy-${card.id}-${recovery?.savedAt ?? Date.now()}`);
  const savedCallback = useRef(saved);
  savedCallback.current = saved;
  const dirty = contentSignature(edit) !== contentSignature(base.current);
  const persist = (value = editRef.current) => {
    const ok = writeLocal(draftKey(userId, card.id), {
      card: value,
      attempt: attempt.current,
      savedAt: recovery?.savedAt ?? Number(copyKey.current.split('-').at(-1)),
    });
    setLocalFailure(!ok);
    return ok;
  };
  const setEdit = (value: Card | ((current: Card) => Card)) => {
    const next = typeof value === 'function' ? value(editRef.current) : value;
    editRef.current = next;
    renderEdit(next);
    setError('');
    if (!saving.current && status !== 'conflict') setStatus(attempt.current ? 'error' : 'pending');
  };
  const saveNow = async () => {
    if (saving.current || working || fieldPending > 0 || recovery || status === 'conflict') return;
    if (!attempt.current && contentSignature(editRef.current) === contentSignature(base.current))
      return;
    saving.current = true;
    setStatus('saving');
    setError('');
    const sent = attempt.current ?? {
      card: structuredClone(editRef.current),
      requestId: crypto.randomUUID(),
    };
    attempt.current = sent;
    persist();
    try {
      const result = await api.saveCard(sent.card, sent.requestId);
      const next = reconcileSaved(editRef.current, sent.card, result);
      base.current = result;
      attempt.current = undefined;
      editRef.current = next;
      renderEdit(next);
      savedCallback.current(result);
      if (contentSignature(next) === contentSignature(result)) {
        removeLocal(draftKey(userId, card.id));
        setStatus('saved');
        setLocalFailure(false);
      } else {
        persist(next);
        setStatus('pending');
      }
    } catch (reason) {
      const known = reason instanceof ApiError && reason.status >= 400 && reason.status < 500;
      if (known) attempt.current = undefined;
      setStatus(known && reason.status === 409 ? 'conflict' : 'error');
      setError(
        known
          ? reason.message
          : 'Сервер не подтвердил сохранение. Черновик оставлен на этом устройстве. Повторите запрос, когда появится связь.',
      );
      persist();
    } finally {
      saving.current = false;
    }
  };
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;
  useEffect(() => {
    if (recovery) return;
    if (dirty || attempt.current) persist();
    if ((!dirty && !attempt.current) || status !== 'pending' || fieldPending > 0 || working) return;
    const timer = window.setTimeout(() => void saveRef.current(), 800);
    return () => window.clearTimeout(timer);
  }, [edit, status, fieldPending, recovery, working]);
  useEffect(() => {
    const online = () => {
      if (attempt.current) void saveRef.current();
    };
    const protect = (event: BeforeUnloadEvent) => {
      if (contentSignature(editRef.current) !== contentSignature(base.current) || attempt.current)
        event.preventDefault();
    };
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', protect);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('beforeunload', protect);
    };
  }, []);
  const closeEditor = () => {
    if (saving.current || working || fieldPending > 0) return;
    if (
      !recovery &&
      (dirty || attempt.current) &&
      !persist() &&
      !window.confirm(
        'Хранилище устройства недоступно. Закрыть запись и потерять несохранённый ввод?',
      )
    )
      return;
    close();
  };
  const closeRef = useRef(closeEditor);
  closeRef.current = closeEditor;
  useEffect(() => {
    const previous = document.activeElement;
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.code === 'KeyS' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        void saveRef.current();
      }
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[contenteditable="true"],a[href]',
      );
      const visible = elements
        ? [...elements].filter(
            (element) => element.offsetParent !== null && !element.closest('fieldset:disabled'),
          )
        : [];
      const first = visible[0];
      const last = visible.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    const preferred = editing ? heading.current : editButton.current;
    if (preferred && !preferred.disabled) preferred.focus();
    else dialog.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [editing]);
  const updateSections = (change: (current: RecordSection[]) => RecordSection[]) =>
    setEdit((current) => ({
      ...current,
      document: sectionDocument(change(recordSections(current))),
    }));
  const updateSection = (id: string, change: Partial<Omit<RecordSection, 'id'>>) =>
    updateSections((current) =>
      current.map((section) => (section.id === id ? { ...section, ...change } : section)),
    );
  const addSection = () => {
    const id = crypto.randomUUID();
    newSection.current = id;
    updateSections((current) => [
      ...current,
      {
        id,
        title: '',
        document: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    ]);
  };
  const fieldActivity = (pending: boolean) =>
    setFieldPending((count) => Math.max(0, count + (pending ? 1 : -1)));
  const work = async (operation: () => Promise<void>) => {
    setWorking(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      setError(reasonText(reason));
    } finally {
      setWorking(false);
    }
  };
  const copyDraft = () =>
    void work(async () => {
      const source = recovery?.card ?? editRef.current;
      const result = await api.capture({
        requestId: copyKey.current,
        project: card.project,
        folder: card.folder ?? undefined,
        kind: card.kind,
        name: `${source.name.slice(0, 108)} (черновик)`,
        content: copiedContent(source.content),
        document: source.document,
      });
      removeLocal(draftKey(userId, card.id));
      copied(result);
    });
  const locked = working || fieldPending > 0;
  return (
    <div
      className="editor-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeEditor();
      }}
    >
      <section
        ref={dialog}
        className="editor"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Редактор записи' : edit.name}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveNow();
          }}
        >
          <header className="editor-header">
            <div>
              {editing ? (
                <input
                  ref={heading}
                  className="editor-title"
                  aria-label={card.kind === 'folder' ? 'Название папки' : 'Название записи'}
                  required
                  maxLength={128}
                  value={edit.name}
                  disabled={!!recovery || working}
                  onChange={(event) =>
                    setEdit((current) => ({ ...current, name: event.target.value }))
                  }
                />
              ) : (
                <h1 className="editor-heading">{edit.name}</h1>
              )}
              {editing && (
                <p className="save-status" role="status">
                  {recovery
                    ? 'Найден черновик на этом устройстве'
                    : fieldPending
                      ? 'Загружаем материал…'
                      : status === 'saved'
                        ? 'Все изменения сохранены'
                        : status === 'saving'
                          ? 'Сохраняем…'
                          : status === 'pending'
                            ? 'Есть изменения · автосохранение'
                            : status === 'conflict'
                              ? 'Нужен разбор изменений'
                              : 'Нет подтверждения сохранения'}
                </p>
              )}
            </div>
            <div className="editor-header-actions">
              {!editing && (
                <IconButton
                  ref={editButton}
                  icon="pencil"
                  label="Редактировать"
                  onClick={() => setEditing(true)}
                />
              )}
              <IconButton
                id="close-editor"
                icon="close"
                label="Закрыть редактор"
                disabled={locked || status === 'saving'}
                onClick={closeEditor}
              />
            </div>
          </header>
          <div className="editor-scroll">
            {recovery && (
              <section className="recovery-panel">
                <h2>Восстановить черновик?</h2>
                <p>
                  «{recovery.card.name}» сохранён на этом устройстве.{' '}
                  {recovery.card.version !== card.version && !recovery.attempt
                    ? 'На сервере уже другая версия. Можно сохранить черновик отдельной записью.'
                    : 'Можно продолжить редактирование с того же места.'}
                </p>
                <pre>{excerpt(recovery.card).slice(0, 1000)}</pre>
                <div className="button-row">
                  {(recovery.card.version === card.version || recovery.attempt) && (
                    <button
                      type="button"
                      className="primary"
                      disabled={working}
                      onClick={() => {
                        attempt.current = recovery.attempt;
                        editRef.current = recovery.card;
                        renderEdit(recovery.card);
                        setRecovery(null);
                        setEditing(true);
                        setStatus('pending');
                      }}
                    >
                      Восстановить черновик
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    disabled={working}
                    onClick={copyDraft}
                  >
                    Сохранить отдельной записью
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={working}
                    onClick={() => {
                      removeLocal(draftKey(userId, card.id));
                      setRecovery(null);
                    }}
                  >
                    Оставить серверную версию
                  </button>
                </div>
              </section>
            )}
            {localFailure && (
              <p className="alert" role="alert">
                Не удалось сохранить черновик на устройстве. Не закрывайте вкладку до подтверждения
                сервера.
              </p>
            )}
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            {status === 'conflict' && (
              <div className="recovery-panel">
                <p>
                  Ваша версия сохранена в черновике. Можно сделать отдельную запись или загрузить
                  текущую версию сервера.
                </p>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={copyDraft}
                    disabled={working}
                  >
                    Сохранить мою версию отдельно
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={working}
                    onClick={() =>
                      void work(async () => {
                        const latest = await api.card(card.id);
                        setRecovery(readDraft(userId, card.id));
                        base.current = latest;
                        editRef.current = latest;
                        renderEdit(latest);
                        savedCallback.current(latest);
                        setStatus('saved');
                      })
                    }
                  >
                    Посмотреть серверную версию
                  </button>
                </div>
              </div>
            )}
            {card.kind !== 'folder' &&
              (editing ? (
                <fieldset
                  className="editor-body record-sections"
                  disabled={locked || !!recovery || status === 'conflict'}
                >
                  {sections.map(({ id, title, document }, index) => (
                    <section
                      className="record-section-editor"
                      key={id}
                      aria-label={`Текстовый блок ${index + 1}`}
                    >
                      <div className="record-section-header">
                        <input
                          autoFocus={newSection.current === id}
                          type="text"
                          placeholder="Заголовок блока"
                          aria-label={`Заголовок блока ${index + 1}`}
                          value={title}
                          maxLength={128}
                          onChange={(event) => updateSection(id, { title: event.target.value })}
                        />
                        {sections.length > 1 && (
                          <IconButton
                            icon="trash"
                            label={`Удалить текстовый блок ${index + 1}`}
                            onClick={() =>
                              updateSections((current) =>
                                current.filter((section) => section.id !== id),
                              )
                            }
                          />
                        )}
                      </div>
                      <RichEditor
                        label={`Текст блока ${index + 1}`}
                        document={document}
                        disabled={locked || !!recovery || status === 'conflict'}
                        change={(next) => updateSection(id, { document: next })}
                        activity={fieldActivity}
                      />
                    </section>
                  ))}
                  <Button icon="plus" onClick={addSection}>
                    Добавить текстовый блок
                  </Button>
                </fieldset>
              ) : (
                <RecordContent sections={sections} />
              ))}
          </div>
          {editing && (
            <footer className="editor-footer">
              <Button
                type="button"
                variant="secondary"
                className="danger"
                icon="trash"
                disabled={
                  locked ||
                  status === 'saving' ||
                  !!recovery ||
                  dirty ||
                  attempt.current !== undefined ||
                  status === 'conflict'
                }
                onClick={() => setConfirmTrash(true)}
              >
                В корзину
              </Button>
              <button
                type="button"
                className="secondary"
                disabled={locked || status === 'saving'}
                onClick={async () => {
                  if (dirty || attempt.current) await saveNow();
                  if (
                    !attempt.current &&
                    contentSignature(editRef.current) === contentSignature(base.current)
                  )
                    setEditing(false);
                }}
              >
                Просмотр
              </button>
              <button
                className="primary"
                aria-keyshortcuts="Meta+S Control+S"
                disabled={
                  locked ||
                  status === 'saving' ||
                  !!recovery ||
                  status === 'conflict' ||
                  (!dirty && !attempt.current)
                }
              >
                {status === 'error' ? 'Повторить сохранение' : 'Сохранить сейчас'}
              </button>
            </footer>
          )}
        </form>
      </section>
      {confirmTrash && (
        <TrashDialog
          card={card}
          busy={working}
          cancel={() => setConfirmTrash(false)}
          confirm={() =>
            void work(async () => {
              await api.deleteCard(card.id);
              removeLocal(draftKey(userId, card.id));
              deleted(card);
            }).finally(() => setConfirmTrash(false))
          }
        />
      )}
    </div>
  );
}
