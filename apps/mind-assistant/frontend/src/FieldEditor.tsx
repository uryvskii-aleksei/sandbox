import { useEffect, useRef, useState } from 'react';

import { api } from './api';
import { labels, safeUrl } from './types';
import type { Field, LinkPreview } from './types';

interface Props {
  field: Field;
  change: (field: Field) => void;
  error: (message: string) => void;
  pending: (value: boolean) => void;
}

export function FieldEditor({ field, change, error, pending }: Props) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const current = useRef(field.value[0] ?? '');
  current.current = field.value[0] ?? '';
  useEffect(() => setPreview(null), [field.value[0]]);
  const setValue = (index: number, value: string) =>
    change({
      ...field,
      value: field.value.map((item, position) => (position === index ? value : item)),
    });
  const loadPreview = async () => {
    const url = current.current;
    setLoading(true);
    pending(true);
    try {
      const result = await api.preview(url);
      if (current.current === url) setPreview(result);
    } catch (reason) {
      error(reason instanceof Error ? reason.message : 'Не удалось загрузить превью.');
    } finally {
      setLoading(false);
      pending(false);
    }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      error('Выберите файл до 5 МБ.');
      return;
    }
    setLoading(true);
    pending(true);
    try {
      const result = await api.upload(file);
      change({ ...field, value: [result.url] });
    } catch (reason) {
      error(reason instanceof Error ? reason.message : 'Не удалось загрузить файл.');
    } finally {
      setLoading(false);
      pending(false);
    }
  };
  const media = safeUrl(field.value[0] ?? '');
  return (
    <div className="field-content">
      <input
        aria-label="Заголовок поля"
        placeholder={`${labels[field.type]} — заголовок`}
        maxLength={128}
        value={field.title}
        onChange={(event) => change({ ...field, title: event.target.value })}
      />
      {field.type === 'textarea' || field.type === 'date' ? (
        <>
          {field.value.map((value, index) => (
            <div className="value-row" key={index}>
              {field.type === 'textarea' ? (
                <textarea
                  aria-label={`Текст ${index + 1}`}
                  rows={3}
                  value={value}
                  onChange={(event) => setValue(index, event.target.value)}
                />
              ) : (
                <input
                  aria-label={`Дата ${index + 1}`}
                  type="date"
                  value={value}
                  onChange={(event) => setValue(index, event.target.value)}
                />
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="Удалить значение"
                onClick={() =>
                  change({
                    ...field,
                    value: field.value.filter((_, position) => position !== index),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            onClick={() => change({ ...field, value: [...field.value, ''] })}
          >
            + Добавить значение
          </button>
        </>
      ) : (
        <>
          <input
            aria-label={field.type === 'url' ? 'Адрес ссылки' : 'Адрес медиафайла'}
            placeholder="https://…"
            value={field.value[0] ?? ''}
            onChange={(event) => change({ ...field, value: [event.target.value] })}
          />
          {field.type === 'url' ? (
            <>
              <button
                type="button"
                className="secondary"
                disabled={loading || !media}
                onClick={() => void loadPreview()}
              >
                {loading ? 'Загрузка…' : 'Загрузить превью'}
              </button>
              {preview && (
                <div className="link-preview">
                  {safeUrl(preview.image) && (
                    <img src={safeUrl(preview.image)} alt="" referrerPolicy="no-referrer" />
                  )}
                  <strong>{preview.title}</strong>
                  <p>{preview.description}</p>
                  <a href={safeUrl(preview.link)} target="_blank" rel="noreferrer">
                    Открыть сайт ↗
                  </a>
                </div>
              )}
            </>
          ) : (
            <>
              <label className="upload-label">
                {loading ? 'Загрузка…' : 'Загрузить файл до 5 МБ'}
                <input
                  type="file"
                  disabled={loading}
                  accept={`${field.type}/*`}
                  onChange={(event) => void upload(event.target.files?.[0])}
                />
              </label>
              {media && field.type === 'image' && (
                <img className="media-preview" src={media} alt={field.title || 'Изображение'} />
              )}
              {media && field.type === 'video' && (
                <video className="media-preview" src={media} controls />
              )}
              {media && field.type === 'audio' && <audio src={media} controls />}
            </>
          )}
        </>
      )}
    </div>
  );
}
