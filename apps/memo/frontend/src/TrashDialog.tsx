import type { BoardSelection, Card } from './types';
import { ConfirmDialog } from './ui';

type Props = {
  busy: boolean;
  error?: string;
  cancel: () => void;
  confirm: () => void;
} & ({ card: Card; selection?: never } | { card?: never; selection: BoardSelection });

export function TrashDialog({ card, selection, busy, error, cancel, confirm }: Props) {
  return (
    <ConfirmDialog
      title={
        card
          ? `Переместить ${card.kind === 'folder' ? 'папку' : 'запись'} в корзину?`
          : 'Удалить выбранные элементы?'
      }
      description={
        card ? (
          `«${card.name}» можно будет восстановить из корзины.`
        ) : (
          <>
            {selection.cards.length > 0 && 'Карточки можно восстановить из корзины. '}
            {selection.marks.length > 0 && 'Выбранная разметка будет удалена.'}
          </>
        )
      }
      action={card || selection?.marks.length ? 'Удалить' : 'В корзину'}
      icon="trash"
      busy={busy}
      error={error}
      dismiss={cancel}
      confirm={confirm}
    />
  );
}
