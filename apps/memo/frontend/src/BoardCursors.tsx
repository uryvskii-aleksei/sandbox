import { useEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { api } from './api';
import type { BoardCursor } from './types';

export type LocalBoardCursor = { point: BoardCursor['point']; movedAt: number } | null;

export function BoardCursors({
  project,
  folder,
  pointer,
  camera,
}: {
  project: number;
  folder: number | null;
  pointer: RefObject<LocalBoardCursor>;
  camera: { x: number; y: number; scale: number };
}) {
  const [peers, setPeers] = useState<BoardCursor[]>([]);
  useEffect(() => {
    const client = crypto.randomUUID();
    const controller = new AbortController();
    let timer: number | undefined;
    let updating = false;
    let expires = 0;
    const update = async () => {
      if (updating || controller.signal.aborted || document.visibilityState !== 'visible') return;
      updating = true;
      window.clearTimeout(timer);
      let interval = 950;
      try {
        const cursors = await api.cursors(
          project,
          folder,
          client,
          pointer.current?.point ?? null,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setPeers((previous) => (cursors.length || previous.length ? cursors : previous));
        expires = performance.now() + 4000;
        if (pointer.current && performance.now() - pointer.current.movedAt < 700) interval = 220;
      } catch {
        if (performance.now() >= expires) setPeers((previous) => (previous.length ? [] : previous));
        interval = 1400;
      } finally {
        updating = false;
        if (!controller.signal.aborted && document.visibilityState === 'visible')
          timer = window.setTimeout(() => void update(), interval);
      }
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void update();
      else {
        pointer.current = null;
        setPeers((previous) => (previous.length ? [] : previous));
        window.clearTimeout(timer);
      }
    };
    document.addEventListener('visibilitychange', visibility);
    void update();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [project, folder, pointer]);

  return peers.map(({ id, user, name, point }) => (
    <div
      key={id}
      className="board-peer-cursor"
      role="img"
      aria-label={'Курсор ' + name}
      style={
        {
          transform:
            'translate(' +
            (camera.x + point.x * camera.scale) +
            'px, ' +
            (camera.y + point.y * camera.scale) +
            'px)',
          '--peer-color': 'hsl(' + ((user * 137.508) % 360) + ' 67% 36%)',
        } as CSSProperties
      }
    >
      <svg width="19" height="22" viewBox="0 0 19 22" aria-hidden="true">
        <path d="m2 2 14 10-7 1.1-3.4 6.3Z" />
      </svg>
      <span>{name}</span>
    </div>
  ));
}
