export function isTextInput(event: KeyboardEvent): boolean {
  return (
    event.target instanceof Element &&
    !!event.target.closest('input, textarea, select, [contenteditable="true"]')
  );
}

export const markTools = [
  {
    kind: 'square',
    icon: 'rectangle',
    label: 'Нарисовать прямоугольник',
    shortLabel: 'Прямоугольник',
    key: 'Q',
  },
  { kind: 'circle', icon: 'circle', label: 'Нарисовать круг', shortLabel: 'Круг', key: 'C' },
] as const;

export const shortcutHelp = [
  ['Поиск', '⌘ / Ctrl + K'],
  ['Добавить запись', 'Alt + Shift + N'],
  ['Добавить папку', 'Alt + Shift + F'],
  ...markTools.map(({ label, key }) => [label, `Alt + Shift + ${key}`] as const),
  ['Полотно / список проекта', 'Alt + Shift + B / V'],
  ['Редактировать выбранную запись', 'E'],
  ['Начать связь от выбранной записи', 'L'],
  ['Выделить рамкой', 'Перетаскивание ЛКМ'],
  ['Переместить полотно', 'Перетаскивание ПКМ или СКМ'],
  ['Удалить выделенное', 'Delete / Backspace'],
  ['Изменить масштаб', '+ / −'],
  ['Сохранить изменения записи', '⌘ / Ctrl + S'],
  ['Отменить действие или снять выделение', 'Esc'],
  ['Показать сочетания клавиш', 'Alt + Shift + H'],
] as const;
