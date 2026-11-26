import type { Card, CardLink, DocumentNode, FieldGroup } from './types';

export const cardWidth = 188;
export const cardHeight = 70;
export const cardDimensions = (card: Card) => card.size ?? { width: cardWidth, height: cardHeight };
export const clampCardSize = (width: number, height: number) => ({
  width: Math.max(180, Math.min(920, Math.round(width))),
  height: Math.max(cardHeight, Math.min(760, Math.round(height))),
});

export function childPosition(cards: Card[], parent: Card): Card['coordinates'] {
  for (let index = 0; index <= cards.length; index++) {
    const point = {
      x: parent.coordinates.x + (index % 5) * (cardWidth + 40),
      y: parent.coordinates.y + cardDimensions(parent).height + 90 + Math.floor(index / 5) * 260,
    };
    if (
      cards.every(
        (card) =>
          point.x + cardWidth + 20 <= card.coordinates.x ||
          point.x >= card.coordinates.x + cardDimensions(card).width + 20 ||
          point.y + cardHeight + 20 <= card.coordinates.y ||
          point.y >= card.coordinates.y + cardDimensions(card).height + 20,
      )
    )
      return point;
  }
  return {
    x: parent.coordinates.x + cardWidth + 40,
    y: parent.coordinates.y + (cards.length + 1) * 260,
  };
}

function documentText(node: DocumentNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'memoMedia') {
    const title: unknown = node.attrs?.title;
    return typeof title === 'string' ? title : '';
  }
  if (node.type === 'memoSection') {
    const title: unknown = node.attrs?.title;
    return [typeof title === 'string' ? title : '', ...(node.content?.map(documentText) ?? [])]
      .filter(Boolean)
      .join('\n');
  }
  const separator = node.type === 'paragraph' || node.type === 'heading' ? '' : '\n';
  return node.content?.map(documentText).join(separator) ?? '';
}

export function excerpt(card: Card): string {
  if (card.document) return documentText(card.document).trim();
  return card.content
    .flatMap((group) => group.fields)
    .filter((field) => field.type === 'textarea' || field.type === 'url')
    .flatMap((field) => field.value)
    .filter(Boolean)
    .join(' · ');
}

export function canConnect(links: CardLink[], source: number, target: number): boolean {
  const pending = [target];
  const visited = new Set<number>();
  while (pending.length) {
    const id = pending.pop();
    if (id === source) return false;
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    pending.push(...links.filter((link) => link.source === id).map((link) => link.target));
  }
  return true;
}

export function branchIds(links: CardLink[], root: number): Set<number> {
  const result = new Set<number>();
  const pending = [root];
  while (pending.length) {
    const id = pending.pop();
    if (id === undefined || result.has(id)) continue;
    result.add(id);
    pending.push(...links.filter((link) => link.source === id).map((link) => link.target));
  }
  return result;
}

export function contentSignature(card: Card): string {
  return JSON.stringify({
    name: card.name,
    document: card.document,
    content: card.content.map((group) => ({
      name: group.name,
      collapsed: group.collapsed,
      fields: group.fields.map((field) => ({
        type: field.type,
        title: field.title,
        value: field.value,
      })),
    })),
  });
}

// Сервер назначает постоянные ID. Сохраняем ввод, сделанный во время запроса.
export function reconcileSaved(current: Card, sent: Card, saved: Card): Card {
  const content = current.content.map((group) => {
    const index = sent.content.findIndex((item) => item.id === group.id);
    const persisted = saved.content[index];
    const previous = sent.content[index];
    if (!persisted || !previous) return group;
    return {
      ...group,
      id: persisted.id,
      name: group.name === previous.name ? persisted.name : group.name,
      fields: group.fields.map((field) => {
        const fieldIndex = previous.fields.findIndex((item) => item.id === field.id);
        return persisted.fields[fieldIndex]
          ? {
              ...field,
              id: persisted.fields[fieldIndex].id,
              title:
                field.title === previous.fields[fieldIndex]?.title
                  ? persisted.fields[fieldIndex].title
                  : field.title,
            }
          : field;
      }),
    };
  });
  return {
    ...current,
    name: current.name === sent.name ? saved.name : current.name,
    version: saved.version,
    document:
      JSON.stringify(current.document) === JSON.stringify(sent.document)
        ? saved.document
        : current.document,
    content,
  };
}

export function copiedContent(content: FieldGroup[]): FieldGroup[] {
  let id = -1;
  return content.map((group) => ({
    ...group,
    id: id--,
    fields: group.fields.map((field) => ({ ...field, id: id--, value: [...field.value] })),
  }));
}
