import { useEffect, useRef, useState } from 'react';
import { Node } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { api, resolveMediaUrl } from './api';
import { documentUrl } from './document';
import type { MemoDocument } from './types';
import { Button } from './ui';

type MediaKind = 'image' | 'video' | 'audio';
type Insertion = 'link' | 'date' | MediaKind;

const MemoMedia = Node.create({
  name: 'memoMedia',
  group: 'block',
  atom: true,
  addAttributes() {
    return { kind: { default: 'image' }, src: { default: '' }, title: { default: '' } };
  },
  renderHTML({ node }) {
    const kind: unknown = node.attrs.kind;
    const src =
      typeof node.attrs.src === 'string' ? documentUrl(resolveMediaUrl(node.attrs.src)) : '';
    const title = typeof node.attrs.title === 'string' ? node.attrs.title : '';
    if (!src) return ['span', {}, 'Вложение'];
    if (kind === 'image') return ['img', { src, alt: title, loading: 'lazy' }];
    if (kind === 'video' || kind === 'audio')
      return [kind, { src, controls: 'true', preload: 'none', 'aria-label': title || 'Вложение' }];
    return ['span', {}, 'Вложение'];
  },
});

const extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: { autolink: false, openOnClick: false, isAllowedUri: (value) => !!documentUrl(value) },
  }),
  MemoMedia,
];
const insertions: Record<Insertion, string> = {
  link: 'Ссылка',
  date: 'Дата',
  image: 'Изображение',
  video: 'Видео',
  audio: 'Аудио',
};

export function RichEditor({
  label,
  document,
  disabled,
  change,
  activity,
}: {
  label: string;
  document: MemoDocument;
  disabled: boolean;
  change: (document: MemoDocument) => void;
  activity: (pending: boolean) => void;
}) {
  const onChange = useRef(change);
  onChange.current = change;
  const [insertion, setInsertion] = useState<Insertion | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const editor = useEditor({
    extensions,
    content: document,
    immediatelyRender: true,
    editorProps: {
      attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' },
    },
    onUpdate: ({ editor: current }) => {
      const json = current.getJSON();
      onChange.current({ type: 'doc', content: json.content ?? [{ type: 'paragraph' }] });
    },
  });
  const format = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold') ?? false,
      italic: editor?.isActive('italic') ?? false,
      heading: editor?.isActive('heading', { level: 2 }) ?? false,
      list: editor?.isActive('bulletList') ?? false,
      link: editor?.isActive('link') ?? false,
    }),
  });
  useEffect(() => {
    if (
      editor &&
      !editor.isDestroyed &&
      editor.schema &&
      !editor.state.doc.eq(editor.schema.nodeFromJSON(document))
    )
      editor.commands.setContent(document, { emitUpdate: false });
  }, [document, editor]);
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!disabled, false);
  }, [disabled, editor]);
  if (!editor) return null;

  const insert = (kind: Insertion, raw: string, title = '') => {
    const value = raw.trim();
    if (kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return setError('Выберите дату.');
      editor.chain().focus().insertContent({ type: 'text', text: value }).run();
    } else {
      const url = documentUrl(value);
      if (!url) return setError('Введите ссылку HTTP или HTTPS.');
      if (kind === 'link') {
        if (editor.isActive('link')) {
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        } else if (editor.state.selection.empty) {
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'text',
              text: value,
              marks: [{ type: 'link', attrs: { href: url } }],
            })
            .run();
        } else editor.chain().focus().setLink({ href: url }).run();
      } else {
        const node: JSONContent = { type: 'memoMedia', attrs: { kind, src: url, title } };
        editor
          .chain()
          .focus()
          .insertContent([node, { type: 'paragraph' }])
          .run();
      }
    }
    setInsertion(null);
    setError('');
    setValue('');
  };
  const upload = async (file: File, kind: MediaKind) => {
    if (file.size > 5 * 1024 * 1024) return setError('Выберите файл до 5 МБ.');
    setUploading(true);
    activity(true);
    setError('');
    try {
      insert(kind, (await api.upload(file)).url, [...file.name].slice(0, 128).join(''));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить вложение.');
    } finally {
      activity(false);
      setUploading(false);
    }
  };
  const isMedia = insertion && insertion !== 'date' && insertion !== 'link' ? insertion : null;
  return (
    <section className="rich-editor" aria-label="Содержимое записи">
      <div className="rich-toolbar" role="group" aria-label="Форматирование и вставка">
        <Button
          disabled={disabled || uploading}
          aria-pressed={format?.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Жирный
        </Button>
        <Button
          disabled={disabled || uploading}
          aria-pressed={format?.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Курсив
        </Button>
        <Button
          disabled={disabled || uploading}
          aria-pressed={format?.heading}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          Заголовок
        </Button>
        <Button
          disabled={disabled || uploading}
          aria-pressed={format?.list}
          icon="list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          Список
        </Button>
        {(Object.keys(insertions) as Insertion[]).map((kind) => (
          <Button
            key={kind}
            disabled={disabled || uploading}
            variant="text"
            aria-pressed={insertion === kind}
            onClick={() => {
              setInsertion(insertion === kind ? null : kind);
              const href: unknown = kind === 'link' ? editor.getAttributes('link').href : null;
              setValue(typeof href === 'string' ? href : '');
              setError('');
            }}
          >
            {insertions[kind]}
          </Button>
        ))}
      </div>
      {insertion && (
        <div className="rich-insert">
          <label>
            {insertion === 'date' ? 'Дата' : 'Адрес ссылки'}
            <input
              key={insertion}
              autoFocus
              type={insertion === 'date' ? 'date' : 'url'}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  insert(insertion, value);
                }
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setInsertion(null);
                  editor.commands.focus();
                }
              }}
            />
          </label>
          <Button
            disabled={disabled || !value.trim() || uploading}
            onClick={() => insert(insertion, value)}
          >
            Вставить
          </Button>
          {insertion === 'link' && format?.link && (
            <Button
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setInsertion(null);
              }}
            >
              Убрать ссылку
            </Button>
          )}
          {isMedia && (
            <label>
              Загрузить файл
              <input
                type="file"
                accept={`${isMedia}/*`}
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void upload(file, isMedia);
                }}
              />
            </label>
          )}
        </div>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <EditorContent editor={editor} />
    </section>
  );
}
