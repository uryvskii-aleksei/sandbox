import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from './api';
import { useWorkspaceClient } from './WorkspaceClient';
import {
  hasSectionContent,
  recordSections,
  sectionDocument,
  sectionText,
  textDocument,
  withoutEmptySections,
} from './document';
import type { RecordSection } from './document';
import { RecordContent } from './RecordContent';
import { contentSignature, copiedContent, excerpt, reconcileSaved } from './graph';
import { routeUrl } from './routes';
import { draftKey, guestUserId, readDraft, removeLocal, writeLocal } from './storage';
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
  const api = useWorkspaceClient();
  const [titleDraft, setTitleDraft] = useState<string | null>(() =>
    initiallyEditing && card.kind === 'folder' ? card.name : null,
  );
  const [editingSections, setEditingSections] = useState<string[]>(() => {
    if (!initiallyEditing || card.kind === 'folder') return [];
    const first = recordSections(card).find((section) => sectionText(section) !== null);
    return first ? [first.id] : [];
  });
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
  const savedContent = contentSignature(base.current);
  const dirty = contentSignature(edit) !== savedContent;
  const bodyDirty =
    dirty && contentSignature({ ...edit, name: base.current.name }) !== savedContent;
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
  const saveNow = async (finishEditing = true) => {
    if (saving.current || working || recovery || status === 'conflict') return;
    const name = finishEditing ? titleDraft?.trim() : undefined;
    const current = name ? { ...editRef.current, name } : editRef.current;
    const prepared = finishEditing && !attempt.current ? withoutEmptySections(current) : current;
    if (finishEditing && titleDraft !== null) setTitleDraft(null);
    if (prepared !== editRef.current) {
      editRef.current = prepared;
      renderEdit(prepared);
    }
    if (!attempt.current && contentSignature(prepared) === contentSignature(base.current)) {
      removeLocal(draftKey(userId, card.id));
      setLocalFailure(false);
      setStatus('saved');
      if (finishEditing) setEditingSections([]);
      return;
    }
    saving.current = true;
    setStatus('saving');
    setError('');
    const sent = attempt.current ?? {
      card: structuredClone(prepared),
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
        if (finishEditing) setEditingSections([]);
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
    else if (status === 'pending') removeLocal(draftKey(userId, card.id));
    if (!dirty || bodyDirty || attempt.current || status !== 'pending' || working) return;
    const timer = window.setTimeout(() => void saveRef.current(false), 800);
    return () => window.clearTimeout(timer);
  }, [edit, status, recovery, working]);
  useEffect(() => {
    if (userId === guestUserId) return;
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
    if (saving.current || working) return;
    if (!recovery && (dirty || attempt.current) && !persist()) setConfirmDiscard(true);
    else close();
  };
  const dismissRef = useRef(closeEditor);
  dismissRef.current = closeEditor;
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
  const editSection = (id: string) => {
    setEditingSections((current) => [...current.filter((item) => item !== id), id]);
  };
  const addSection = () => {
    const id = crypto.randomUUID();
    setEditingSections((current) => [...(empty ? [sections[0].id] : current), id]);
    updateSections((current) => [...current, { id, title: '', document: textDocument('') }]);
  };
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
  const canEdit = !working && !recovery && status !== 'conflict';
  const visibleSections = sections.filter(
    (section) => hasSectionContent(section) || editingSections.includes(section.id),
  );
  const empty = !visibleSections.length;
  const textSections = empty ? sections.slice(0, 1) : visibleSections;
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
                <textarea
                  autoFocus
                  rows={Math.min(4, titleDraft.split('\n').length)}
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
                    if (event.key === 'Enter' && !event.shiftKey) {
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
                disabled={working || status === 'saving'}
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
                        setEditingSections(
                          recordSections(recovery.card)
                            .filter((section) => sectionText(section) !== null)
                            .map(({ id }) => id),
                        );
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
                        setEditingSections([]);
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
                {textSections.map((section, index) => {
                  const text = sectionText(section);
                  if (text !== null && (empty || editingSections.includes(section.id))) {
                    return (
                      <textarea
                        key={section.id}
                        className="record-text-input"
                        aria-label={`Текст ${index + 1}`}
                        placeholder="Введите текст"
                        rows={4}
                        autoFocus={canEdit && (empty || editingSections.at(-1) === section.id)}
                        value={text}
                        readOnly={!canEdit || status === 'saving'}
                        onChange={(event) => {
                          if (empty) editSection(section.id);
                          updateSection(section.id, { document: textDocument(event.target.value) });
                        }}
                      />
                    );
                  }
                  return (
                    <RecordContent
                      key={section.id}
                      section={section}
                      edit={canEdit && text !== null ? () => editSection(section.id) : undefined}
                      index={index}
                    />
                  );
                })}
                <IconButton
                  icon="plus"
                  className="primary"
                  label="Добавить текст"
                  disabled={!canEdit || status === 'saving'}
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
              Удалить
            </Button>
            {status === 'saving' && (
              <p className="save-status" role="status">
                Сохраняем…
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={
                !canEdit ||
                status === 'saving' ||
                (!dirty && !attempt.current && !editingSections.length)
              }
            >
              {status === 'error' ? 'Повторить сохранение' : 'Сохранить'}
            </Button>
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
