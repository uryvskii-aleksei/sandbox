import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { resolveMediaUrl } from './api';
import { documentUrl, hasSectionContent, sectionText } from './document';
import type { RecordSection } from './document';
import type { DocumentNode } from './types';

function contentNodes(nodes: DocumentNode[] = []): ReactNode {
  return nodes.map((node, index) => <Fragment key={index}>{contentNode(node)}</Fragment>);
}

function contentNode(node: DocumentNode): ReactNode {
  switch (node.type) {
    case 'text':
      return (
        node.marks?.reduce<ReactNode>((content, mark) => {
          if (mark.type === 'bold') return <strong>{content}</strong>;
          if (mark.type === 'italic') return <em>{content}</em>;
          const href =
            mark.type === 'link' && typeof mark.attrs?.href === 'string'
              ? documentUrl(resolveMediaUrl(mark.attrs.href))
              : '';
          return href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {content}
            </a>
          ) : (
            content
          );
        }, node.text) ?? node.text
      );
    case 'hardBreak':
      return <br />;
    case 'paragraph':
      return node.content?.length ? <p>{contentNodes(node.content)}</p> : null;
    case 'heading':
      return node.attrs?.level === 3 ? (
        <h4>{contentNodes(node.content)}</h4>
      ) : (
        <h3>{contentNodes(node.content)}</h3>
      );
    case 'bulletList':
      return <ul>{contentNodes(node.content)}</ul>;
    case 'orderedList':
      return (
        <ol start={typeof node.attrs?.start === 'number' ? node.attrs.start : 1}>
          {contentNodes(node.content)}
        </ol>
      );
    case 'listItem':
      return <li>{contentNodes(node.content)}</li>;
    case 'memoMedia': {
      const src =
        typeof node.attrs?.src === 'string' ? documentUrl(resolveMediaUrl(node.attrs.src)) : '';
      const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
      if (!src) return null;
      if (node.attrs?.kind === 'image') return <img src={src} alt={title} loading="lazy" />;
      if (node.attrs?.kind === 'video')
        return <video src={src} aria-label={title || 'Видео'} controls preload="none" />;
      if (node.attrs?.kind === 'audio')
        return <audio src={src} aria-label={title || 'Аудио'} controls preload="none" />;
      return null;
    }
    default:
      return null;
  }
}

export function RecordContent({
  section,
  index,
  edit,
}: {
  section: RecordSection;
  index: number;
  edit?: () => void;
}) {
  const text = sectionText(section);
  return (
    <section
      className={edit ? 'record-content editable-section' : 'record-content'}
      tabIndex={edit ? 0 : undefined}
      aria-label={`${section.title || `Текстовый блок ${index + 1}`}${edit ? '. Enter для редактирования' : ''}`}
      onClick={(event) => {
        if (!(event.target instanceof Element) || event.target.closest('a, button, audio, video'))
          return;
        if (window.getSelection()?.isCollapsed !== false) edit?.();
      }}
      onKeyDown={(event) => {
        if (
          !edit ||
          event.target !== event.currentTarget ||
          (event.key !== 'Enter' && event.key !== ' ')
        )
          return;
        event.preventDefault();
        edit();
      }}
    >
      {section.title && <h2>{section.title}</h2>}
      {text === null
        ? contentNodes(section.document.content)
        : text && <p className="record-plain-text">{text}</p>}
      {!hasSectionContent(section) && <p className="help-text">Пустой блок</p>}
    </section>
  );
}
