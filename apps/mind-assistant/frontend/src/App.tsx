import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { api } from './api';
import { Board } from './Board';
import { FieldEditor } from './FieldEditor';
import { fieldTypes, labels, moveItem } from './types';
import type { Card, Field, FieldGroup, Project, User } from './types';

function projectFromPath(): number | null {
  const match = location.pathname.match(/\/workplace\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Не удалось выполнить действие.';

export function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<number | null>(projectFromPath);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<Card | null>(null);
  const [fieldPending, setFieldPending] = useState(0);
  const editorRef = useRef<HTMLElement>(null);
  const editorBusy = busy || fieldPending > 0;
  const [projectName, setProjectName] = useState('');
  const [newProject, setNewProject] = useState('');
  const temporaryId = useRef(-1);
  const editorHeading = useRef<HTMLInputElement>(null);
  const active = projects.find((project) => project.id === selected);
  const dirty =
    edit !== null &&
    JSON.stringify(edit) !== JSON.stringify(cards.find((card) => card.id === edit.id));
  useEffect(() => {
    let live = true;
    void api
      .session()
      .then((session) => {
        if (live) {
          setUser(session.user);
          setReady(true);
        }
      })
      .catch((reason: unknown) => {
        if (live) {
          setError(message(reason));
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void api
      .projects(controller.signal)
      .then(setProjects)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(message(reason));
      });
    return () => controller.abort();
  }, [user]);
  useEffect(() => {
    if (!user || selected === null) {
      setCards([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api
      .cards(selected, controller.signal)
      .then(setCards)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(message(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user, selected]);
  useEffect(() => setProjectName(active?.name ?? ''), [active?.id, active?.name]);
  useEffect(() => {
    const update = () => {
      if (editorBusy || (dirty && !window.confirm('Закрыть карточку без сохранения?'))) {
        history.pushState(
          null,
          '',
          `${import.meta.env.BASE_URL}${selected ? `workplace/${selected}` : 'dashboard'}`,
        );
        return;
      }
      setSelected(projectFromPath());
      setEdit(null);
    };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, [dirty, editorBusy, selected]);
  useEffect(() => {
    if (!edit) return;
    const previous = document.activeElement;
    editorHeading.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        document.getElementById('close-editor')?.click();
      }
      if (event.key !== 'Tab') return;
      const elements = editorRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
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
  }, [edit?.id]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);

  const navigate = (id: number | null) => {
    if (editorBusy) return;
    if (dirty && !window.confirm('Закрыть карточку без сохранения?')) return;
    history.pushState(
      null,
      '',
      `${import.meta.env.BASE_URL}${id ? `workplace/${id}` : 'dashboard'}`,
    );
    setSelected(id);
    setEdit(null);
    setError('');
  };
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  const authenticate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action(async () => {
      const session = await api.auth(mode, String(data.get('email')), String(data.get('password')));
      setUser(session.user);
    });
  };
  const createProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void action(async () => {
      const project = await api.createProject(newProject);
      setProjects((items) => [project, ...items]);
      setNewProject('');
      navigate(project.id);
    });
  };
  const createCard = (parent: Card | null = null) => {
    if (!selected) return;
    void action(async () => {
      const coordinates = parent
        ? { x: parent.coordinates.x + 40, y: parent.coordinates.y + 170 }
        : { x: 70 + (cards.length % 3) * 290, y: 70 + Math.floor(cards.length / 3) * 170 };
      const card = await api.createCard(selected, parent?.id ?? null, coordinates);
      setCards((items) => [...items, card]);
      setEdit(structuredClone(card));
      setProjects(await api.projects());
    });
  };
  const updatePosition = async (card: Card) =>
    action(async () => {
      const result = await api.position(card);
      setCards((items) => items.map((item) => (item.id === result.id ? result : item)));
    });
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!edit || editorBusy) return;
    void action(async () => {
      const saved = await api.saveCard(edit);
      setCards((items) => items.map((item) => (item.id === saved.id ? saved : item)));
      setEdit(null);
    });
  };
  const closeEditor = () => {
    if (editorBusy) return;
    if (!dirty || window.confirm('Закрыть карточку без сохранения?')) setEdit(null);
  };
  const changeGroup = (index: number, group: FieldGroup) => {
    if (edit)
      setEdit({
        ...edit,
        content: edit.content.map((item, position) => (position === index ? group : item)),
      });
  };
  const changeField = (groupId: number, fieldId: number, field: Field) => {
    setEdit((current) =>
      current
        ? {
            ...current,
            content: current.content.map((group) =>
              group.id === groupId
                ? {
                    ...group,
                    fields: group.fields.map((item) => (item.id === fieldId ? field : item)),
                  }
                : group,
            ),
          }
        : null,
    );
  };
  const fieldActivity = (pending: boolean) =>
    setFieldPending((count) => Math.max(0, count + (pending ? 1 : -1)));
  const reorderGroup = (index: number, offset: number) => {
    if (edit) setEdit({ ...edit, content: moveItem(edit.content, index, offset) });
  };
  const reorderField = (groupIndex: number, index: number, offset: number) => {
    if (!edit) return;
    const group = edit.content[groupIndex];
    changeGroup(groupIndex, { ...group, fields: moveItem(group.fields, index, offset) });
  };

  if (!ready) return <main className="loading-screen">Загружаем пространство…</main>;
  if (!user)
    return (
      <main className="auth-page">
        <section className="auth-intro">
          <span className="brand-mark">m.</span>
          <p className="eyebrow">MINDASSISTANT</p>
          <h1>
            Дайте мыслям
            <br />
            своё пространство.
          </h1>
          <p>
            Соединяйте идеи, собирайте материалы и превращайте разрозненные заметки в понятную
            картину.
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
          <h2>{mode === 'login' ? 'С возвращением' : 'Начнём с аккаунта'}</h2>
          <p>
            {mode === 'login'
              ? 'Войдите, чтобы продолжить работу с идеями.'
              : 'Все проекты и материалы будут доступны только вам.'}
          </p>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => location.reload()}>Повторить подключение</button>
            </div>
          )}
          <form onSubmit={authenticate}>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required maxLength={254} />
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
            <button className="primary" disabled={busy}>
              {busy ? 'Подождите…' : mode === 'login' ? 'Войти в пространство' : 'Создать аккаунт'}
            </button>
          </form>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
          </button>
        </section>
      </main>
    );

  return (
    <div className="application">
      <aside className="sidebar">
        <a
          className="brand"
          href={`${import.meta.env.BASE_URL}dashboard`}
          onClick={(event) => {
            event.preventDefault();
            navigate(null);
          }}
        >
          <span className="brand-mark">m.</span>MindAssistant
        </a>
        <p className="nav-section">ЛИЧНОЕ ПРОСТРАНСТВО</p>
        <button
          className={`nav-item ${selected === null ? 'selected' : ''}`}
          onClick={() => navigate(null)}
        >
          ▦ <span>Мои проекты</span>
          <small>{projects.length}</small>
        </button>
        <p className="nav-section">ПРОЕКТЫ</p>
        <nav aria-label="Проекты">
          {projects.map((project) => (
            <button
              disabled={busy}
              className={`nav-item ${selected === project.id ? 'selected' : ''}`}
              key={project.id}
              onClick={() => navigate(project.id)}
            >
              <span className="project-dot" />
              <span>{project.name}</span>
              <small>{project.cards ?? 0}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{user.email[0].toUpperCase()}</span>
          <span title={user.email}>{user.email}</span>
          <button
            className="icon-button"
            disabled={busy}
            aria-label="Выйти"
            onClick={() =>
              void action(async () => {
                await api.logout();
                setUser(null);
                setProjects([]);
                setCards([]);
                setEdit(null);
              })
            }
          >
            ↪
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">
              {selected ? 'ПРОЕКТ / ПРОСТРАНСТВО МЫСЛЕЙ' : 'ВАШЕ ПРОСТРАНСТВО'}
            </p>
            <h1>{active?.name ?? (selected ? 'Загрузка проекта…' : 'Мои проекты')}</h1>
          </div>
          {active && (
            <button className="primary" disabled={busy || !!edit} onClick={() => createCard()}>
              ＋ Добавить мысль
            </button>
          )}
        </header>
        {error && (
          <div className="alert workspace-alert" role="alert">
            {error}
            <button onClick={() => setError('')} aria-label="Скрыть ошибку">
              ×
            </button>
          </div>
        )}
        {selected === null ? (
          <section className="dashboard">
            <p className="lead">
              Каждому замыслу — своё место. Выберите проект или создайте новый.
            </p>
            <form className="new-project" onSubmit={createProject}>
              <label className="sr-only" htmlFor="new-project">
                Название нового проекта
              </label>
              <input
                id="new-project"
                required
                maxLength={128}
                placeholder="Название нового проекта"
                value={newProject}
                onChange={(event) => setNewProject(event.target.value)}
              />
              <button className="primary" disabled={busy || !newProject.trim()}>
                Создать проект
              </button>
            </form>
            <div className="project-grid">
              {projects.map((project) => (
                <button
                  className="project-tile"
                  key={project.id}
                  onClick={() => navigate(project.id)}
                >
                  <span className="tile-symbol">⌘</span>
                  <h2>{project.name}</h2>
                  <p>{project.cards ?? 0} карточек</p>
                  <span className="tile-arrow">↗</span>
                </button>
              ))}
            </div>
            {!projects.length && (
              <div className="empty-projects">
                <span>✧</span>
                <h2>Большие идеи начинаются с малого</h2>
                <p>
                  Создайте первый проект, чтобы собрать мысли, ссылки и материалы на одном полотне.
                </p>
              </div>
            )}
          </section>
        ) : (
          <>
            {active && (
              <div className="project-toolbar">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(async () => {
                      const updated = await api.renameProject(active.id, projectName);
                      setProjects((items) =>
                        items.map((item) =>
                          item.id === updated.id ? { ...item, ...updated } : item,
                        ),
                      );
                    });
                  }}
                >
                  <label className="sr-only" htmlFor="project-name">
                    Название проекта
                  </label>
                  <input
                    id="project-name"
                    value={projectName}
                    maxLength={128}
                    onChange={(event) => setProjectName(event.target.value)}
                  />
                  <button
                    className="text-button"
                    disabled={busy || !projectName.trim() || projectName === active.name}
                  >
                    Переименовать
                  </button>
                </form>
                <span>{cards.length} карточек</span>
                <button
                  className="danger text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Удалить проект и все его карточки?'))
                      void action(async () => {
                        await api.deleteProject(active.id);
                        setProjects((items) => items.filter((item) => item.id !== active.id));
                        navigate(null);
                      });
                  }}
                >
                  Удалить проект
                </button>
              </div>
            )}
            {loading ? (
              <div className="loading-screen">Загружаем мысли…</div>
            ) : (
              <Board
                cards={cards}
                busy={busy || !!edit}
                open={(card) => setEdit(structuredClone(card))}
                child={(card) => createCard(card)}
                position={updatePosition}
              />
            )}
          </>
        )}
      </main>
      {edit && (
        <div className="editor-backdrop">
          <section
            ref={editorRef}
            className="editor"
            role="dialog"
            aria-modal="true"
            aria-label="Редактор карточки"
          >
            <form onSubmit={save}>
              <header className="editor-header">
                <div>
                  <p className="eyebrow">КАРТОЧКА / {dirty ? 'ЕСТЬ ИЗМЕНЕНИЯ' : 'СОХРАНЕНО'}</p>
                  <input
                    ref={editorHeading}
                    disabled={editorBusy}
                    className="editor-title"
                    aria-label="Название карточки"
                    required
                    maxLength={128}
                    value={edit.name}
                    onChange={(event) => setEdit({ ...edit, name: event.target.value })}
                  />
                </div>
                <button
                  className="icon-button"
                  type="button"
                  id="close-editor"
                  aria-label="Закрыть редактор"
                  disabled={editorBusy}
                  onClick={closeEditor}
                >
                  ×
                </button>
              </header>
              <fieldset className="editor-body" disabled={editorBusy}>
                <label>
                  Связать с карточкой
                  <select
                    value={edit.parent ?? ''}
                    onChange={(event) =>
                      setEdit({
                        ...edit,
                        parent: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                  >
                    <option value="">Без родителя</option>
                    {cards
                      .filter((card) => card.id !== edit.id)
                      .map((card) => (
                        <option value={card.id} key={card.id}>
                          {card.name}
                        </option>
                      ))}
                  </select>
                </label>
                {edit.content.map((group, groupIndex) => (
                  <section className="field-group" key={group.id}>
                    <header>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={group.collapsed ? 'Развернуть группу' : 'Свернуть группу'}
                        onClick={() =>
                          changeGroup(groupIndex, { ...group, collapsed: !group.collapsed })
                        }
                      >
                        {group.collapsed ? '▸' : '▾'}
                      </button>
                      <input
                        aria-label="Название группы"
                        placeholder="Группа материалов"
                        maxLength={128}
                        value={group.name}
                        onChange={(event) =>
                          changeGroup(groupIndex, { ...group, name: event.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Поднять группу"
                        disabled={groupIndex === 0}
                        onClick={() => reorderGroup(groupIndex, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Опустить группу"
                        disabled={groupIndex === edit.content.length - 1}
                        onClick={() => reorderGroup(groupIndex, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label="Удалить группу"
                        onClick={() =>
                          setEdit({
                            ...edit,
                            content: edit.content.filter((_, index) => index !== groupIndex),
                          })
                        }
                      >
                        ×
                      </button>
                    </header>
                    {!group.collapsed && (
                      <div className="group-fields">
                        {group.fields.map((field, fieldIndex) => (
                          <div className="field" key={field.id}>
                            <div className="field-bar">
                              <span>{labels[field.type]}</span>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Поднять поле"
                                disabled={fieldIndex === 0}
                                onClick={() => reorderField(groupIndex, fieldIndex, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Опустить поле"
                                disabled={fieldIndex === group.fields.length - 1}
                                onClick={() => reorderField(groupIndex, fieldIndex, 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="icon-button danger"
                                aria-label="Удалить поле"
                                onClick={() =>
                                  changeGroup(groupIndex, {
                                    ...group,
                                    fields: group.fields.filter((_, index) => index !== fieldIndex),
                                  })
                                }
                              >
                                ×
                              </button>
                            </div>
                            <FieldEditor
                              field={field}
                              change={(next) => changeField(group.id, field.id, next)}
                              error={setError}
                              pending={fieldActivity}
                            />
                          </div>
                        ))}
                        <div className="add-fields">
                          {fieldTypes.map((type) => (
                            <button
                              type="button"
                              className="text-button"
                              key={type}
                              onClick={() =>
                                changeGroup(groupIndex, {
                                  ...group,
                                  fields: [
                                    ...group.fields,
                                    {
                                      id: temporaryId.current--,
                                      type,
                                      title: '',
                                      order: group.fields.length,
                                      value: [''],
                                    },
                                  ],
                                })
                              }
                            >
                              + {labels[type]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                ))}
                <button
                  type="button"
                  className="secondary add-group"
                  onClick={() =>
                    setEdit({
                      ...edit,
                      content: [
                        ...edit.content,
                        {
                          id: temporaryId.current--,
                          name: '',
                          order: edit.content.length,
                          collapsed: false,
                          fields: [],
                        },
                      ],
                    })
                  }
                >
                  ＋ Добавить группу полей
                </button>
              </fieldset>
              {error && (
                <div className="alert" role="alert">
                  {error}
                </div>
              )}
              <footer className="editor-footer" aria-busy={editorBusy}>
                <button
                  type="button"
                  className="text-button danger"
                  disabled={editorBusy}
                  onClick={() => {
                    if (window.confirm('Удалить карточку? Дочерние карточки останутся на полотне.'))
                      void action(async () => {
                        await api.deleteCard(edit.id);
                        setEdit(null);
                        if (selected) setCards(await api.cards(selected));
                        setProjects(await api.projects());
                      });
                  }}
                >
                  Удалить
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={editorBusy}
                  onClick={closeEditor}
                >
                  Отмена
                </button>
                <button className="primary" disabled={editorBusy}>
                  {busy ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
