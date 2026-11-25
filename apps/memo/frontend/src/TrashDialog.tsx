import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { BoardSelection, Card } from './types';
import { Button } from './ui';

type Props = {
  busy: boolean;
  error?: string;
  cancel: () => void;
  confirm: () => void;
} & ({ card: Card; selection?: never } | { card?: never; selection: BoardSelection });

export function TrashDialog({ card, selection, busy, error, cancel, confirm }: Props) {
  const title = useId();
  const description = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="trash-dialog"
      role="alertdialog"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) cancel();
      }}
    >
      <h2 id={title}>
        {card
          ? `Переместить ${card.kind === 'folder' ? 'папку' : 'запись'} в корзину?`
          : 'Удалить выбранные элементы?'}
      </h2>
      <p id={description}>
        {card ? (
          `«${card.name}» можно будет восстановить из корзины.`
        ) : (
          <>
            {selection.cards.length > 0 && 'Карточки можно восстановить из корзины. '}
            {selection.marks.length > 0 && 'Выбранная разметка будет удалена.'}
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="trash-dialog-actions">
        <Button autoFocus disabled={busy} onClick={cancel}>
          Отмена
        </Button>
        <Button className="danger" icon="trash" disabled={busy} onClick={confirm}>
          {selection?.marks.length ? 'Удалить' : 'В корзину'}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}
