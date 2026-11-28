import { createPlaybackProgress } from './playback.mjs';

const rutubeOrigin = 'https://rutube.ru';

export function setupEmbedPlayer(screen, onState) {
  let frame;
  let timeout;
  let progress;
  let duration;
  let ready;
  let playable;
  let started;
  let playing;
  let seeking;
  let ad;

  function clear() {
    clearTimeout(timeout);
    frame?.remove();
    frame = undefined;
  }

  function command(action) {
    frame?.contentWindow.postMessage(
      JSON.stringify({ type: `player:${action}`, data: {} }),
      rutubeOrigin,
    );
  }

  function setState(state) {
    if (state === 'ended' && !started) return;
    if (state === 'error') clear();
    if (state === 'ready' || state === 'playing') {
      clearTimeout(timeout);
      frame.style.visibility = '';
      frame.inert = false;
    }
    onState(state);
  }

  function load(clip) {
    clear();
    progress = createPlaybackProgress();
    duration = undefined;
    ready = playable = started = playing = seeking = ad = false;

    const url = new URL(clip.embed);
    url.searchParams.set('getPlayOptions', 'id,acl_access,has_video,detail');
    frame = document.createElement('iframe');
    frame.className = 'embed-player';
    frame.title = `${clip.artist} — ${clip.title}`;
    frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    frame.style.visibility = 'hidden';
    frame.inert = true;
    frame.src = url;
    screen.prepend(frame);
    timeout = setTimeout(() => setState('error'), 8000);
  }

  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== rutubeOrigin) return;
    let message = event.data;
    if (typeof message === 'string') {
      try {
        message = JSON.parse(message);
      } catch {
        return;
      }
    }

    const data = message?.data;
    switch (message?.type) {
      case 'player:ready':
        ready = true;
        command('play');
        if (playable && !started) setState('ready');
        break;
      case 'player:playOptionLoaded':
      case 'player:playOptionsLoaded': {
        const options = data?.playOptions ?? data;
        // RUTUBE присылает ready даже для загруженной заглушки с ошибкой.
        if (
          options?.acl_access?.allowed === false ||
          options?.has_video === false ||
          options?.detail
        ) {
          setState('error');
        } else if (Number.isInteger(options?.id) && options.id > 0) {
          playable = true;
          if (ready && !started) setState('ready');
        }
        break;
      }
      case 'player:changeState':
        if (data?.state === 'playing') {
          started = playing = true;
          seeking = false;
          setState('playing');
        } else {
          progress.interrupt();
          if (data?.state === 'seeking' || data?.state === 'seeked') {
            seeking = data.state === 'seeking';
          } else if (data?.state === 'paused' || data?.state === 'pause') {
            playing = false;
            if (started) setState('paused');
          } else if (data?.state === 'stopped') {
            playing = false;
          }
        }
        break;
      case 'player:durationChange':
        if (!ad && Number.isFinite(data?.duration) && data.duration > 0) duration = data.duration;
        break;
      case 'player:currentTime':
        if (playing && !ad && !seeking) progress.sample(data?.time, performance.now());
        break;
      case 'player:seeking':
      case 'player:seeked':
        seeking = message.type === 'player:seeking';
        progress.interrupt();
        break;
      case 'player:rollState':
        if (data?.state !== 'play' && data?.state !== 'complete') break;
        ad = data.state === 'play';
        progress.interrupt();
        break;
      case 'player:adStart':
      case 'player:adEnd':
        ad = message.type === 'player:adStart';
        progress.interrupt();
        break;
      case 'player:playComplete':
        setState('ended');
        break;
      case 'player:error':
        setState('error');
        break;
    }
  });

  return {
    load,
    clear,
    command,
    get element() {
      return frame;
    },
    get playback() {
      return {
        watched: progress?.watched ?? 0,
        duration,
        canSkip: Boolean(frame && started && !ad && !seeking),
      };
    },
  };
}
