import { ApiError } from './api';
import type { WorkspaceDataClient } from './WorkspaceClient';
import { withoutEmptySections } from './document';
import { canConnect, cardDimensions, cardHeight, cardWidth } from './graph';
import type { EntityRef } from './routes';
import { guestUserId, readDraft } from './storage';
import type { BoardMark, Card, CardLink, Folder, GuestProjectSnapshot, Project } from './types';

export const guestProjectId = 1;
const defaultName = 'Мой проект';
const publicId = () => 'm' + crypto.randomUUID().replaceAll('-', '');
type Edge = Pick<CardLink, 'source' | 'target' | 'label'>;
type Mark = BoardMark & { folder: number | null };
type Point = Card['coordinates'];

export function createGuestWorkspace() {
  let name = defaultName;
  let sequence = 0;
  let edges: Edge[] = [];
  const cards = new Map<number, Card>();
  const marks = new Map<number, Mark>();
  const liveCards = () => Array.from(cards.values()).filter((card) => !card.deletedAt);
  const project = (): Project => ({ id: guestProjectId, name, cards: liveCards().length });
  const boardCards = (folder: number | null) =>
    liveCards().filter((card) => card.folder === folder);
  const missing = () => {
    throw new ApiError('Элемент полотна не найден.', 404);
  };
  const cardAt = (id: EntityRef): Card => {
    const card =
      typeof id === 'number' ? cards.get(id) : liveCards().find((item) => item.publicId === id);
    return !card || card.deletedAt ? missing() : card;
  };
  const folderAt = (id: number | null) => {
    if (id !== null && cardAt(id).kind !== 'folder') missing();
  };
  const markAt = (id: number) => marks.get(id) ?? missing();
  const changeCard = (card: Card) => {
    const saved = { ...card, version: card.version + 1 };
    cards.set(saved.id, saved);
    return structuredClone(saved);
  };
  const linkOutput = (edge: Edge): CardLink => ({
    ...edge,
    sourceName: cards.get(edge.source)?.name ?? '',
    targetName: cards.get(edge.target)?.name ?? '',
    sourceProject: guestProjectId,
    targetProject: guestProjectId,
  });
  const activeEdges = () =>
    edges.filter(
      ({ source, target }) => !cards.get(source)?.deletedAt && !cards.get(target)?.deletedAt,
    );
  const updateParent = (id: number) => {
    const card = cardAt(id);
    changeCard({ ...card, parent: edges.find((edge) => edge.target === id)?.source ?? null });
  };
  const connect: WorkspaceDataClient['connect'] = async (source, target, label = '') => {
    cardAt(source);
    cardAt(target);
    const remaining = edges.filter((edge) => edge.source !== source || edge.target !== target);
    if (!canConnect(remaining.map(linkOutput), source, target))
      throw new ApiError('Эта связь создаёт цикл.', 422);
    const edge = { source, target, label: label.trim() };
    edges = [...remaining, edge];
    updateParent(target);
    return linkOutput(edge);
  };
  const trashCards = (ids: number[]) => {
    const selected = ids.map(cardAt);
    if (
      liveCards().some(
        (card) =>
          card.folder !== null &&
          card.folder !== undefined &&
          ids.includes(card.folder) &&
          !ids.includes(card.id),
      )
    )
      throw new ApiError('Сначала освободите папку.', 409);
    for (const card of selected) changeCard({ ...card, deletedAt: new Date().toISOString() });
  };
  const nextPoint = (folder: number | null): Point => {
    const neighbors = boardCards(folder);
    for (let index = 0; index <= neighbors.length * 20; index++) {
      const x = 80 + (index % 3) * (cardWidth + 40);
      const y = 80 + Math.floor(index / 3) * (cardHeight + 45);
      if (
        neighbors.every((card) => {
          const point = card.coordinates;
          const size = cardDimensions(card);
          return (
            x + cardWidth + 16 <= point.x ||
            point.x + size.width + 16 <= x ||
            y + cardHeight + 16 <= point.y ||
            point.y + size.height + 16 <= y
          );
        })
      )
        return { x, y };
    }
    return { x: 1200, y: 80 };
  };
  const shiftPoint = (point: Point, offset: Point): Point => ({
    x: point.x + offset.x,
    y: point.y + offset.y,
  });
  const shiftMark = (mark: Mark, offset: Point, folder: number | null): Mark =>
    mark.kind === 'label'
      ? { ...mark, at: shiftPoint(mark.at, offset), folder }
      : { ...mark, at: shiftPoint(mark.at, offset), end: shiftPoint(mark.end, offset), folder };

  const client: WorkspaceDataClient = {
    projects: async () => [project()],
    project: async () => project(),
    renameProject: async (_id, next) => {
      name = next.trim();
      return project();
    },
    cards: async (_project, folder) => structuredClone(boardCards(folder)),
    folders: async () =>
      liveCards().flatMap((card): Folder[] =>
        card.kind === 'folder' && card.publicId
          ? [{ id: card.id, publicId: card.publicId, name: card.name, folder: card.folder ?? null }]
          : [],
      ),
    links: async () => activeEdges().map(linkOutput),
    card: async (id) => structuredClone(cardAt(id)),
    visit: async (id) => structuredClone(cardAt(id)),
    capture: async (body) => {
      const folder = body.folder ?? null;
      folderAt(folder);
      const card: Card = {
        id: ++sequence,
        name: body.name?.trim() || (body.kind === 'folder' ? 'Новая папка' : 'Новая запись'),
        project: guestProjectId,
        kind: body.kind ?? 'record',
        folder,
        parent: null,
        size: { width: cardWidth, height: cardHeight },
        autoHeight: true,
        coordinates: body.coordinates ?? nextPoint(folder),
        version: 1,
        content: [],
        ...(body.kind === 'folder' ? { publicId: publicId() } : { document: body.document }),
      };
      cards.set(card.id, card);
      if (body.parent) await connect(body.parent, card.id);
      return structuredClone(cardAt(card.id));
    },
    saveCard: async (card) => {
      const current = cardAt(card.id);
      return changeCard({
        ...current,
        name: card.name.trim(),
        document: card.document,
        size: current.autoHeight ? card.size : current.size,
      });
    },
    position: async (card) => {
      const current = cardAt(card.id);
      return changeCard({
        ...current,
        coordinates: card.coordinates,
        size: card.size,
        autoHeight: card.autoHeight,
      });
    },
    copyCard: async (id, body) => {
      const root = cardAt(id);
      const ids = new Map<number, number>();
      const copy = (card: Card, folder: number | null) => {
        const duplicate = {
          ...structuredClone(card),
          id: ++sequence,
          folder,
          version: 1,
          parent: null,
          coordinates: card.id === id ? body.coordinates : card.coordinates,
          publicId: card.kind === 'folder' ? publicId() : undefined,
        };
        ids.set(card.id, duplicate.id);
        cards.set(duplicate.id, duplicate);
        for (const child of boardCards(card.id)) copy(child, duplicate.id);
        return duplicate;
      };
      const duplicate = copy(root, body.folder);
      for (const mark of Array.from(marks.values())) {
        const folder = mark.folder === null ? undefined : ids.get(mark.folder);
        if (folder !== undefined) {
          const copied = { ...structuredClone(mark), id: ++sequence, folder };
          marks.set(copied.id, copied);
        }
      }
      for (const edge of activeEdges()) {
        const source = ids.get(edge.source),
          target = ids.get(edge.target);
        if (source !== undefined && target !== undefined) await connect(source, target, edge.label);
      }
      return structuredClone(cardAt(duplicate.id));
    },
    deleteCard: async (id) => {
      trashCards([id]);
      return null;
    },
    restoreCard: async (id) => {
      const card = cards.get(id) ?? missing();
      folderAt(card.folder ?? null);
      return changeCard({ ...card, deletedAt: null });
    },
    connect,
    disconnect: async (link) => {
      edges = edges.filter((edge) => edge.source !== link.source || edge.target !== link.target);
      updateParent(link.target);
      return null;
    },
    reconnectLink: async (link, source, target) => {
      const prior = edges;
      edges = prior.filter((edge) => edge.source !== link.source || edge.target !== link.target);
      try {
        const saved = await connect(source, target, link.label);
        if (link.target !== target) updateParent(link.target);
        return saved;
      } catch (reason) {
        edges = prior;
        throw reason;
      }
    },
    marks: async (_project, folder) =>
      structuredClone(Array.from(marks.values()).filter((mark) => mark.folder === folder)),
    createMark: async (_project, folder, mark) => {
      const created = { ...structuredClone(mark), id: ++sequence, folder };
      marks.set(created.id, created);
      return created;
    },
    editMark: async (id, patch) => {
      const updated = { ...markAt(id), ...structuredClone(patch) };
      marks.set(id, updated);
      return updated;
    },
    deleteMark: async (id) => {
      marks.delete(id);
      return null;
    },
    moveSelection: async (_project, folder, selected, selectedMarks, move) => {
      const cardRows = selected.map(({ id }) => cardAt(id));
      const markRows = selectedMarks.map(markAt);
      const destination = 'destination' in move ? move.destination : folder;
      folderAt(destination);
      let offset: Point;
      if ('offset' in move) offset = move.offset;
      else {
        const points = [
          ...cardRows.map((card) => card.coordinates),
          ...markRows.flatMap((mark) => (mark.kind === 'label' ? [mark.at] : [mark.at, mark.end])),
        ];
        const bottom = Math.max(
          0,
          ...boardCards(destination).map(
            (card) => card.coordinates.y + cardDimensions(card).height,
          ),
          ...Array.from(marks.values())
            .filter((mark) => mark.folder === destination)
            .map((mark) => (mark.kind === 'label' ? mark.at.y : Math.max(mark.at.y, mark.end.y))),
        );
        offset = {
          x: 80 - Math.min(...points.map((point) => point.x)),
          y: bottom + 80 - Math.min(...points.map((point) => point.y)),
        };
      }
      return {
        cards: cardRows.map((card) =>
          changeCard({
            ...card,
            folder: destination,
            coordinates: shiftPoint(card.coordinates, offset),
          }),
        ),
        marks: markRows.map((mark) => {
          const moved = shiftMark(mark, offset, destination);
          marks.set(mark.id, moved);
          return moved;
        }),
      };
    },
    trashSelection: async (_project, _folder, ids, selectedMarks) => {
      trashCards(ids);
      for (const id of selectedMarks) marks.delete(id);
      return null;
    },
  };
  const snapshot = (): GuestProjectSnapshot | null => {
    const entries = liveCards();
    const visibleMarks = Array.from(marks.values()).filter(
      (mark) => mark.folder === null || !cards.get(mark.folder)?.deletedAt,
    );
    if (!entries.length && !visibleMarks.length && name === defaultName) return null;
    return structuredClone({
      name,
      cards: entries.map((entry) => {
        const draft = readDraft(guestUserId, entry.id)?.card;
        const card = withoutEmptySections({
          ...entry,
          name: draft?.version === entry.version ? draft.name : entry.name,
          document: draft?.document ?? entry.document,
        });
        const { id, name, kind, folder, coordinates, autoHeight, document } = card;
        return {
          id,
          name,
          kind,
          folder,
          coordinates,
          size: cardDimensions(card),
          autoHeight,
          document,
        };
      }),
      links: activeEdges(),
      marks: visibleMarks,
    });
  };
  return { client, snapshot };
}
