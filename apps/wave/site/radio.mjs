import { setupAccount } from './account.mjs?v=6';
import { setupEmbedPlayer } from './embed-player.mjs?v=5';
import { playbackSignal, watchedSeconds } from './playback.mjs';
import { pickClip } from './selection.mjs?v=5';
import { setupSoundscape, trackHue } from './soundscape.mjs?v=4';

const get = (id) => document.getElementById(id);
const toggle = get('toggle');
const previous = get('previous');
const next = get('next');
const like = get('like');
const dislike = get('dislike');
const video = get('video');
const clipPreview = get('clip-preview');
const poster = get('clip-poster');
const screen = get('video-screen');
const deck = screen.closest('.deck');
const soundscape = setupSoundscape(video, get('soundscape'), get('viewport-glow'));
const trackDetails = get('track-details');
const clipDetails = get('clip-details');
const source = get('video-source');
const license = get('clip-license');
const message = get('player-message');
const recentKey = 'wave:recent-clips';
const historyLimit = 100;
const recentLimit = 600;
const noRecommendations =
  'Все клипы отмечены как «Не нравится». Снимите оценку у этого клипа, чтобы продолжить.';
const noPlayable = 'Доступные клипы не загрузились. Нажмите «Воспроизвести», чтобы повторить.';

const shortcuts = new Map([
  ['ArrowLeft', previous],
  ['ArrowRight', next],
  ['KeyL', like],
  ['KeyD', dislike],
  ['KeyI', trackDetails],
]);

let catalog = [];
let catalogFailed = false;
let history = [];
let position = -1;
let playbackRequest = 0;
let recent = readRecent();
let previewRatings;
let embedState = 'idle';
let recordedPlayback = false;
const unavailable = new Set();
const account = setupAccount(() => {
  if (position < 0 && catalog.length && previewRatings !== account.ratings) preparePreview();
  render();
});
const current = () => history[position];
const trackOnScreen = () => current() ?? history[0];
const embedded = setupEmbedPlayer(screen, onEmbedState);

function rateableClip() {
  if (unavailable.has(current()?.id)) return null;
  return (
    current() ?? (history.length ? null : catalog.find((clip) => account.ratings[clip.id] === -1))
  );
}

function readRecent() {
  try {
    const ids = JSON.parse(localStorage.getItem(recentKey));
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string').slice(-recentLimit) : [];
  } catch {
    return [];
  }
}

function rememberClip(clip) {
  if (recent.at(-1) === clip.id) return;
  recent = [...recent.filter((id) => id !== clip.id), clip.id].slice(-recentLimit);
  try {
    localStorage.setItem(recentKey, JSON.stringify(recent));
  } catch {
    // В приватном режиме историю можно продолжать в памяти текущей страницы.
  }
}

function render() {
  const clip = current();
  const rated = rateableClip();
  const track = unavailable.has(clip?.id) ? null : (clip ?? history[0] ?? rated);
  const pause = clip?.embed
    ? embedState === 'playing'
    : !video.paused && !video.ended && !video.error;
  const label = pause ? 'Пауза' : 'Воспроизвести';
  get('toggle-icon').className = 'symbol ' + (pause ? 'pause' : 'play');
  toggle.setAttribute('aria-label', label);
  toggle.dataset.tooltip = label + ' · Пробел';
  toggle.disabled = !history.length && !catalogFailed && !unavailable.size;
  previous.disabled =
    position <= 0 || !history.slice(0, position).some((item) => !unavailable.has(item.id));
  next.disabled = !clip;
  like.disabled = dislike.disabled = !rated || account.busy;
  like.setAttribute('aria-pressed', String(account.ratings[rated?.id] === 1));
  dislike.setAttribute('aria-pressed', String(account.ratings[rated?.id] === -1));
  trackDetails.hidden = !track;
  if (track) {
    get('track-artist').textContent = track.artist;
    get('track-title').textContent = track.title;
    get('clip-credit').textContent = track.credit;
    source.href = track.source;
    source.textContent = track.embed ? 'RUTUBE' : 'Wikimedia Commons';
    license.hidden = !track.license;
    if (track.license) {
      license.textContent = track.license.name;
      license.href = track.license.url;
    }
    video.setAttribute('aria-label', track.artist + ' — ' + track.title);
  }
}

function recordPlayback(outcome) {
  const clip = current();
  if (!clip || recordedPlayback || unavailable.has(clip.id)) return;
  const details = clip.embed
    ? embedded.playback
    : {
        watched: watchedSeconds(video.played),
        duration: video.duration,
        canSkip:
          !video.error && !video.seeking && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
      };
  if (outcome === 'skip' && !details.canSkip) return;
  const signal = playbackSignal(outcome, details.watched, details.duration);
  if (!signal) return;
  account.recordPlayback(clip.id, signal);
  recordedPlayback = true;
  history = history.slice(0, position + 1);
}

function rejectClip(clip) {
  unavailable.add(clip.id);
  if (current()) {
    clearNativeVideo();
    advance();
    return;
  }
  preparePreview();
  render();
}

function onEmbedState(state) {
  embedState = state;
  soundscape.setEmbeddedPlaying(state === 'playing');
  const clip = current();
  if (state === 'ended') {
    recordPlayback('ended');
    advance();
    return;
  }
  if (state === 'playing') {
    unavailable.delete(clip.id);
    message.textContent = '';
  } else if (state === 'error') {
    rejectClip(clip);
    return;
  } else if (state === 'ready') {
    message.textContent = 'Нажмите ▶ в плеере, если клип не запустился.';
  }
  render();
}

function play() {
  const request = ++playbackRequest;
  soundscape.activate();
  const promise = video.play();
  render();
  promise.catch((error) => {
    if (request !== playbackRequest || error.name === 'AbortError') return;
    if (error.name === 'NotAllowedError') {
      message.textContent = 'Нажмите «Воспроизвести», чтобы продолжить.';
    } else {
      rejectClip(current());
      return;
    }
    render();
  });
}

function applyTrackTheme(clip) {
  const hue = trackHue(clip);
  const root = document.documentElement;
  root.style.setProperty('--accent', `hsl(${hue} 88% 72%)`);
  root.classList.add('has-clip');
  return hue;
}

function clearNativeVideo() {
  video.hidden = true;
  if (!video.hasAttribute('src')) return;
  playbackRequest++;
  video.removeAttribute('src');
  video.load();
}

function show(clip, keepPreviewRatio = false) {
  recordedPlayback = false;
  rememberClip(clip);
  clipPreview.hidden = true;
  soundscape.setEmbeddedPlaying(false);
  soundscape.cue(applyTrackTheme(clip));
  if (!keepPreviewRatio) deck.style.removeProperty('--video-ratio');
  if (clip.embed) {
    clearNativeVideo();
    embedState = 'loading';
    message.textContent = 'Загружаем плеер…';
    embedded.load(clip);
    render();
    return;
  }
  embedded.clear();
  video.hidden = false;
  video.controls = true;
  if (clip.poster) video.poster = clip.poster;
  else video.removeAttribute('poster');
  video.src = clip.video;
  message.textContent = 'Загружаем клип…';
  play();
}

function chooseClip() {
  return pickClip(catalog, account.ratings, { recent, unavailable, playback: account.playback });
}

function advance() {
  const preview = position < 0 ? history[0] : null;
  const forward = history.findIndex(
    (clip, index) =>
      index > position && account.ratings[clip.id] !== -1 && !unavailable.has(clip.id),
  );
  if (forward >= 0) {
    position = forward;
  } else {
    const clip = chooseClip();
    if (!clip) {
      message.textContent = unavailable.size ? noPlayable : noRecommendations;
      render();
      return false;
    }
    history = [...history.slice(0, position + 1), clip].slice(-historyLimit);
    position = history.length - 1;
  }
  show(current(), current() === preview);
  return true;
}

function rateCurrent(direction) {
  const clip = rateableClip();
  if (!clip) return;
  const before = account.ratings[clip.id];
  void account.rate(clip.id, direction);
  const after = account.ratings[clip.id];
  if (clip !== current() || before === after) return;

  // После реакции следующий клип выбирается с учётом новых предпочтений.
  history = history.slice(0, position + 1);
  if (after === -1) advance();
}

function playOrPause() {
  if (!catalog.length) {
    if (catalogFailed) void loadCatalog();
  } else if (!current()) {
    if (!advance() && unavailable.size) {
      unavailable.clear();
      advance();
    }
  } else if (unavailable.has(current().id)) {
    unavailable.delete(current().id);
    show(current());
  } else if (current().embed) {
    embedded.command(embedState === 'playing' ? 'pause' : 'play');
  } else if (video.paused || video.ended) {
    play();
  } else {
    video.pause();
  }
}

function preparePreview() {
  previewRatings = account.ratings;
  const first = chooseClip();
  if (first === history[0] && first) return;

  history = first ? [first] : [];
  clearNativeVideo();
  clipPreview.hidden = !first;
  deck.style.removeProperty('--video-ratio');
  if (!first) {
    message.textContent = unavailable.size ? noPlayable : noRecommendations;
    return;
  }
  applyTrackTheme(first);
  poster.hidden = !first.poster;
  if (first.poster) poster.src = first.poster;
  else poster.removeAttribute('src');
  message.textContent = '';
}

async function refreshCatalog() {
  try {
    const response = await fetch('./api.php?catalog=1', { signal: AbortSignal.timeout(6500) });
    if (!response.ok) return;
    const { clips } = await response.json();
    catalog = [...new Map([...catalog, ...clips].map((clip) => [clip.id, clip])).values()];
    if (!history.length && position < 0) {
      preparePreview();
      render();
    }
  } catch {
    // Стартовая подборка работает, пока внешний каталог временно недоступен.
  }
}

async function loadCatalog() {
  catalogFailed = false;
  message.textContent = '';
  render();
  try {
    const response = await fetch('./catalog.json?v=6', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    const clips = await response.json();
    if (!Array.isArray(clips) || !clips.length) throw new Error();
    await account.ready;
    catalog = clips;
    preparePreview();
    void refreshCatalog();
  } catch {
    catalogFailed = true;
    message.textContent =
      'Подборка не загрузилась. Нажмите «Воспроизвести», чтобы попробовать снова.';
  }
  render();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (embedded.element) await embedded.element.requestFullscreen();
    else if (video.webkitDisplayingFullscreen) video.webkitExitFullscreen();
    else if (document.fullscreenEnabled) await video.requestFullscreen();
    else if (video.webkitSupportsFullscreen) video.webkitEnterFullscreen();
    else throw new Error();
  } catch {
    message.textContent = 'Не удалось включить полноэкранный режим.';
  }
}

document.addEventListener('keydown', (event) => {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;
  const target = event.target;
  if (
    !(target instanceof Element) ||
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') ||
    document.querySelector('dialog[open]')
  )
    return;

  if (event.code === 'KeyF' && current()) {
    event.preventDefault();
    void toggleFullscreen();
    return;
  }

  const space = event.code === 'Space' || event.key === ' ';
  const arrow = event.code === 'ArrowLeft' || event.code === 'ArrowRight';
  // Когда в фокусе встроенный видеоплеер, его клавиши управляют просмотром и перемоткой.
  if ((space || arrow) && target === video && video.controls) return;
  if (space && target.closest('button, a[href]')) return;

  const button = space ? toggle : shortcuts.get(event.code);
  if (!button || button.disabled || button.hidden) return;
  event.preventDefault();
  button.click();
});

trackDetails.addEventListener('click', () => clipDetails.showModal());
clipPreview.addEventListener('click', playOrPause);
toggle.addEventListener('click', playOrPause);
next.addEventListener('click', () => {
  recordPlayback('skip');
  advance();
});
previous.addEventListener('click', () => {
  if (position <= 0) return;
  const index = history.slice(0, position).findLastIndex((clip) => !unavailable.has(clip.id));
  if (index >= 0) {
    position = index;
    show(current());
  }
});
like.addEventListener('click', () => rateCurrent(1));
dislike.addEventListener('click', () => rateCurrent(-1));

poster.addEventListener('load', () => {
  if (!current() && poster.naturalWidth && poster.naturalHeight) {
    deck.style.setProperty('--video-ratio', String(poster.naturalWidth / poster.naturalHeight));
  }
});
poster.addEventListener('error', () => {
  poster.hidden = true;
});
video.addEventListener('resize', () => {
  if (!trackOnScreen()?.embed && video.videoWidth && video.videoHeight) {
    deck.style.setProperty('--video-ratio', String(video.videoWidth / video.videoHeight));
  }
});
video.addEventListener('play', render);
video.addEventListener('playing', () => {
  const clip = current();
  if (clip?.embed) return;
  if (clip) unavailable.delete(clip.id);
  message.textContent = '';
  render();
});
video.addEventListener('pause', () => {
  if (!trackOnScreen()?.embed && video.paused && !video.ended && !video.error)
    message.textContent = '';
  render();
});
video.addEventListener('waiting', () => {
  if (!trackOnScreen()?.embed && !video.paused) message.textContent = 'Загружаем клип…';
});
video.addEventListener('ended', () => {
  if (!current() || current().embed || !video.ended) return;
  recordPlayback('ended');
  advance();
});
video.addEventListener('error', () => {
  const track = trackOnScreen();
  if (track && !track.embed && video.error) rejectClip(track);
});

void loadCatalog();
