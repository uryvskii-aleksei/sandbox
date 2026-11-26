import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { RichEditor } from './RichEditor';
import { hasSectionContent, recordSections, sectionDocument } from './document';
import type { RecordSection } from './document';
import { RecordContent } from './RecordContent';
import { contentSignature, copiedContent, excerpt, reconcileSaved } from './graph';
import { routeUrl } from './routes';
import { draftKey, readDraft, removeLocal, writeLocal } from './storage';
import { TrashDialog } from './TrashDialog';
import type { Draft, SaveAttempt } from './storage';
import type { Card } from './types';
import { Button, ConfirmDialog, IconButton } from './ui';

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
  const [titleDraft, setTitleDraft] = useState<string | null>(() =>
    initiallyEditing ? card.name : null,
  );
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sectionEditor = useRef<HTMLFieldSetElement>(null);
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
  const [copyLinkStatus, setCopyLinkStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [localFailure, setLocalFailure] = useState(false);
  const [fieldPending, setFieldPending] = useState(0);
  const [working, setWorking] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const recordLink =
    card.kind !== 'folder' && card.publicId
      ? new URL(
          routeUrl(import.meta.env.BASE_URL, { view: 'record', record: card.publicId }),
          location.origin,
        ).href
      : '';
  const copyRecordLink = async () => {
    try {
      await navigator.clipboard.writeText(recordLink);
      setCopyLinkStatus('copied');
    } catch {
      setCopyLinkStatus('manual');
    }
  };
  const saving = useRef(false);
  const attempt = useRef<SaveAttempt | undefined>(undefined);
  const dialog = useRef<HTMLElement>(null);
  const sections = useMemo(() => recordSections(edit), [edit.document, edit.content]);
  const copyKey = useRef(`draft-copy-${card.id}-${recovery?.savedAt ?? Date.now()}`);
  const savedCallback = useRef(saved);
  savedCallback.current = saved;
  const dirty = contentSignature(edit) !== contentSignature(base.current);
  useEffect(() => {
    if (
      card.version <= base.current.version ||
      dirty ||
      recovery ||
      saving.current ||
      attempt.current
    )
      return;
    base.current = card;
    editRef.current = card;
    renderEdit(card);
  }, [card, dirty, recovery]);
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
    if (!recovery && (dirty || attempt.current) && !persist()) setConfirmDiscard(true);
    else close();
  };
  const dismissRef = useRef(closeEditor);
  dismissRef.current =
    activeSection && !working && fieldPending === 0 ? () => setActiveSection(null) : closeEditor;
  useEffect(() => {
    const previous = document.activeElement;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.target instanceof Element) ||
        !dialog.current?.contains(event.target) ||
        event.target.closest('dialog[open]')
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
      }
      if (event.code === 'KeyS' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        void saveRef.current();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!activeSection || working || fieldPending > 0) return;
    const outside = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (!event.target.closest('dialog[open]') && !sectionEditor.current?.contains(event.target))
        setActiveSection(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [activeSection, working, fieldPending]);
  const commitTitle = () => {
    const next = titleDraft?.trim();
    setTitleDraft(null);
    if (next && next !== editRef.current.name) setEdit((current) => ({ ...current, name: next }));
  };
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
    setActiveSection(id);
    updateSections((current) => [
      ...current.filter((section) => section.id !== 'legacy' || hasSectionContent(section)),
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
  const canEdit = !locked && !recovery && status !== 'conflict';
  const visibleSections = sections.filter(
    (section) => section.id !== 'legacy' || hasSectionContent(section),
  );
  const finishSection = async () => {
    await saveNow();
    if (!attempt.current && contentSignature(editRef.current) === contentSignature(base.current))
      setActiveSection((current) => (current === activeSection ? null : current));
  };
  return (
    <>
      <section ref={dialog} className="editor" aria-label={edit.name}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveNow();
          }}
        >
          <header className="editor-header">
            <div>
              {titleDraft !== null ? (
                <input
                  autoFocus
                  className="editor-title"
                  aria-label={card.kind === 'folder' ? 'Название папки' : 'Название записи'}
                  maxLength={128}
                  value={titleDraft}
                  disabled={!canEdit}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitTitle();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      setTitleDraft(null);
                    }
                  }}
                />
              ) : (
                <h1 className="editor-heading">
                  <button
                    type="button"
                    data-edit-record=""
                    title={edit.name}
                    disabled={!canEdit}
                    onClick={() => setTitleDraft(edit.name)}
                  >
                    {edit.name}
                  </button>
                </h1>
              )}
            </div>
            <div className="editor-header-actions">
              {recordLink && (
                <IconButton
                  icon="link"
                  label="Скопировать ссылку на запись"
                  onClick={() => void copyRecordLink()}
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
            {copyLinkStatus === 'copied' && (
              <p className="help-text" role="status">
                Ссылка скопирована.
              </p>
            )}
            {copyLinkStatus === 'manual' && (
              <>
                <p className="help-text" role="status">
                  Скопируйте ссылку вручную.
                </p>
                <label>
                  Ссылка на запись
                  <input
                    autoFocus
                    readOnly
                    value={recordLink}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
              </>
            )}
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
            {card.kind !== 'folder' && (
              <div className="editor-body record-sections">
                {visibleSections.map((section, index) =>
                  activeSection === section.id ? (
                    <fieldset
                      ref={sectionEditor}
                      className="record-section-editor"
                      key={section.id}
                      disabled={!canEdit}
                      aria-label={`Текстовый блок ${index + 1}`}
                    >
                      <div className="record-section-header">
                        <input
                          type="text"
                          placeholder="Заголовок блока"
                          aria-label={`Заголовок блока ${index + 1}`}
                          value={section.title}
                          maxLength={128}
                          onChange={(event) =>
                            updateSection(section.id, { title: event.target.value })
                          }
                        />
                      </div>
                      <RichEditor
                        label={`Текст блока ${index + 1}`}
                        document={section.document}
                        disabled={!canEdit}
                        autoFocus
                        change={(next) => updateSection(section.id, { document: next })}
                        activity={fieldActivity}
                      />
                      <div className="record-section-actions">
                        <IconButton
                          icon="trash"
                          label="Удалить блок"
                          className="danger"
                          onClick={() => {
                            setActiveSection(null);
                            updateSections((current) =>
                              current.filter(({ id }) => id !== section.id),
                            );
                          }}
                        />
                        <Button
                          variant="primary"
                          disabled={status === 'saving'}
                          onClick={() => void finishSection()}
                        >
                          Сохранить
                        </Button>
                      </div>
                    </fieldset>
                  ) : (
                    <RecordContent
                      key={section.id}
                      section={section}
                      edit={canEdit ? () => setActiveSection(section.id) : undefined}
                      index={index}
                    />
                  ),
                )}
                {!visibleSections.length && <p className="empty-message">Пока без содержания</p>}
                <IconButton
                  icon="plus"
                  className="primary"
                  label="Добавить блок"
                  tooltip="Добавить блок"
                  disabled={!canEdit}
                  onClick={addSection}
                />
              </div>
            )}
          </div>
          <footer className="editor-footer">
            <Button
              variant="secondary"
              className="danger"
              icon="trash"
              disabled={!canEdit || status === 'saving' || dirty || attempt.current !== undefined}
              onClick={() => setConfirmTrash(true)}
            >
              В корзину
            </Button>
            {status === 'error' && (
              <Button type="submit" variant="primary" disabled={!canEdit}>
                Повторить сохранение
              </Button>
            )}
            {(status === 'saving' || fieldPending > 0) && (
              <p className="save-status" role="status">
                {fieldPending > 0 ? 'Загружаем материал…' : 'Сохраняем…'}
              </p>
            )}
          </footer>
        </form>
      </section>
      {confirmDiscard && (
        <ConfirmDialog
          title="Закрыть запись без сохранения?"
          description="Черновик недоступен. Несохранённый ввод будет потерян."
          action="Закрыть"
          dismiss={() => setConfirmDiscard(false)}
          confirm={close}
        />
      )}
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
    </>
  );
}
