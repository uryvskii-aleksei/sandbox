export function isTextInput(event: KeyboardEvent): boolean {
  return (
    event.target instanceof Element &&
    !!event.target.closest('input, textarea, select, [contenteditable="true"]')
  );
}

export const markTools = [
  { kind: 'label', icon: 'text', label: 'Добавить подпись', key: 'P' },
  { kind: 'line', icon: 'line', label: 'Нарисовать линию', key: 'L' },
  { kind: 'square', icon: 'rectangle', label: 'Нарисовать прямоугольник', key: 'Q' },
  { kind: 'circle', icon: 'circle', label: 'Нарисовать круг', key: 'C' },
] as const;

export const shortcutHelp = [
  ['Поиск', '⌘ / Ctrl + K'],
  ['Быстрая запись', 'Alt + N'],
  ['Добавить запись', 'Alt + Shift + N'],
  ['Добавить папку', 'Alt + Shift + F'],
  ...markTools.map(({ label, key }) => [label, `Alt + Shift + ${key}`] as const),
  ['Полотно / список проекта', 'Alt + Shift + B / V'],
  ['Редактировать выбранную запись', 'E'],
  ['Начать связь от выбранной записи', 'L'],
  ['Удалить выделенное', 'Delete / Backspace'],
  ['Изменить масштаб', '+ / −'],
  ['Сохранить быструю запись', '⌘ / Ctrl + Enter'],
  ['Сохранить изменения записи', '⌘ / Ctrl + S'],
  ['Отменить действие или снять выделение', 'Esc'],
  ['Показать сочетания клавиш', 'Alt + Shift + H'],
] as const;
