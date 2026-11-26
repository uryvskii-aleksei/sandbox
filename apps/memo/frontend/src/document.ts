import { safeUrl } from './types';
import type { Card, DocumentNode, MemoDocument } from './types';

export interface RecordSection {
  id: string;
  title: string;
  document: MemoDocument;
}

export function hasSectionContent({ title, document }: RecordSection): boolean {
  return (
    !!title || document.content.some((node) => node.type !== 'paragraph' || !!node.content?.length)
  );
}

export function sectionText({ document }: RecordSection): string | null {
  const paragraphs: string[] = [];
  for (const paragraph of document.content) {
    if (paragraph.type !== 'paragraph') return null;
    let text = '';
    for (const node of paragraph.content ?? []) {
      if (node.type === 'hardBreak') text += '\n';
      else if (node.type === 'text' && !node.marks?.length) text += node.text ?? '';
      else return null;
    }
    paragraphs.push(text);
  }
  return paragraphs.join('\n');
}

export function textDocument(text: string): MemoDocument {
  const content = text
    .split('\n')
    .flatMap((line, index): DocumentNode[] => [
      ...(index ? [{ type: 'hardBreak' }] : []),
      ...(line ? [{ type: 'text', text: line }] : []),
    ]);
  return {
    type: 'doc',
    content: [content.length ? { type: 'paragraph', content } : { type: 'paragraph' }],
  };
}

export function withoutEmptySections(card: Card): Card {
  if (!card.document?.content.every((node) => node.type === 'memoSection')) return card;
  const sections = recordSections(card);
  const populated = sections.filter((section) => {
    const text = sectionText(section);
    return text === null || !!section.title || !!text.trim();
  });
  return populated.length === sections.length
    ? card
    : { ...card, document: sectionDocument(populated) };
}

export function recordSections(card: Card): RecordSection[] {
  const document = card.document ?? legacyDocument(card);
  if (!document.content.every((node) => node.type === 'memoSection'))
    return [{ id: 'legacy', title: '', document }];
  return document.content.map((node, index) => ({
    id: typeof node.attrs?.id === 'string' ? node.attrs.id : `section-${index}`,
    title: typeof node.attrs?.title === 'string' ? node.attrs.title : '',
    document: {
      type: 'doc',
      content: node.content?.length ? node.content : [{ type: 'paragraph' }],
    },
  }));
}

export function sectionDocument(sections: RecordSection[]): MemoDocument {
  if (!sections.length) return { type: 'doc', content: [{ type: 'paragraph' }] };
  return {
    type: 'doc',
    content: sections.map(({ id, title, document }) => ({
      type: 'memoSection',
      attrs: { id, title },
      content: document.content,
    })),
  };
}

export const documentUrl = (value: string) =>
  /^(?:https?:\/\/|\/(?:[a-zA-Z0-9_-]+\/)*api\/media\/[a-f0-9]{32}$)/i.test(value)
    ? safeUrl(value)
    : '';

export function legacyDocument(card: Card): MemoDocument {
  const content: DocumentNode[] = [];
  const addText = (value: string, type = 'paragraph', attrs?: DocumentNode['attrs']) => {
    if (!value) return;
    const parts = value
      .split(/\r?\n/)
      .flatMap((line, index) => [
        ...(index ? [{ type: 'hardBreak' }] : []),
        ...(line ? [{ type: 'text', text: line }] : []),
      ]);
    content.push({ type, attrs, content: parts });
  };
  for (const group of card.content) {
    if (group.name && group.name !== 'Заметка') addText(group.name, 'heading', { level: 2 });
    for (const field of group.fields) {
      if (field.title) addText(field.title, 'heading', { level: 3 });
      for (const value of field.value) {
        if (!value) continue;
        const url = documentUrl(value);
        if (url && field.type === 'url') {
          content.push({
            type: 'paragraph',
            content: [
              { type: 'text', text: value, marks: [{ type: 'link', attrs: { href: url } }] },
            ],
          });
        } else if (url && ['image', 'video', 'audio'].includes(field.type)) {
          content.push({
            type: 'memoMedia',
            attrs: { kind: field.type, src: url, title: field.title },
          });
        } else addText(value);
      }
    }
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
