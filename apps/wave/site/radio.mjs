import { setupAccount } from './account.mjs?v=2';
import { pickClip } from './selection.mjs';
import { setupSoundscape, trackHue } from './soundscape.mjs?v=3';

const get = (id) => document.getElementById(id);
const toggle = get('toggle');
const previous = get('previous');
const next = get('next');
const like = get('like');
const dislike = get('dislike');
const video = get('video');
const screen = get('video-screen');
const deck = screen.closest('.deck');
const soundscape = setupSoundscape(video, get('soundscape'), get('viewport-glow'));
const trackDetails = get('track-details');
const clipDetails = get('clip-details');
const source = get('video-source');
const message = get('player-message');

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
const unavailable = new Set();
const account = setupAccount(render);
const current = () => history[position];

function render() {
  const clip = current();
  const track = clip ?? history[0];
  const pause = !video.paused && !video.ended && !video.error;
  const label = pause ? 'Пауза' : 'Воспроизвести';
  get('toggle-icon').className = 'symbol ' + (pause ? 'pause' : 'play');
  toggle.setAttribute('aria-label', label);
  toggle.dataset.tooltip = label + ' · Пробел';
  toggle.disabled = !catalog.length && !catalogFailed;
  previous.disabled = position <= 0;
  next.disabled = !clip;
  like.disabled = dislike.disabled = !clip || account.busy;
  like.setAttribute('aria-pressed', String(account.ratings[clip?.id] === 1));
  dislike.setAttribute('aria-pressed', String(account.ratings[clip?.id] === -1));
  trackDetails.hidden = !track;
  if (track) {
    get('track-artist').textContent = track.artist;
    get('track-title').textContent = track.title;
    get('clip-credit').textContent = track.credit;
    source.href = track.source;
    video.setAttribute('aria-label', track.artist + ' — ' + track.title);
  }
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
    } else if (!video.error) {
      message.textContent = 'Клип не удалось запустить. Попробуйте снова или выберите следующий.';
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

function show(clip, keepFirstFrame = false) {
  video.controls = true;
  soundscape.cue(applyTrackTheme(clip));
  if (!keepFirstFrame || video.error) video.src = clip.video;
  message.textContent =
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ? 'Загружаем клип…' : '';
  play();
}

function advance() {
  const firstStart = position < 0;
  if (position + 1 < history.length) {
    position++;
  } else {
    const recent = history.map((item) => item.id);
    let clip = pickClip(catalog, account.ratings, recent, unavailable);
    // Если все клипы успели вернуть ошибку, разрешаем повторную попытку.
    if (!clip) {
      unavailable.clear();
      clip = pickClip(catalog, account.ratings, recent, unavailable);
    }
    history = [...history, clip].slice(-100);
    position = history.length - 1;
  }
  show(current(), firstStart);
}

function playOrPause() {
  if (!catalog.length) {
    if (catalogFailed) void loadCatalog();
  } else if (!current()) {
    advance();
  } else if (video.error) {
    show(current());
  } else if (video.paused || video.ended) {
    play();
  } else {
    video.pause();
  }
}

async function loadCatalog() {
  catalogFailed = false;
  message.textContent = '';
  render();
  try {
    const response = await fetch('./catalog.json', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    const clips = await response.json();
    if (!Array.isArray(clips) || !clips.length) throw new Error();
    const first = pickClip(clips, account.ratings, [], unavailable);
    if (!first) throw new Error();
    applyTrackTheme(first);
    catalog = clips;
    history = [first];
    message.textContent = 'Загружаем первый кадр…';
    video.src = first.video;
    video.hidden = false;
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
toggle.addEventListener('click', playOrPause);
next.addEventListener('click', advance);
previous.addEventListener('click', () => {
  if (position > 0) {
    position--;
    show(current());
  }
});
like.addEventListener('click', () => account.rate(current().id, 1));
dislike.addEventListener('click', () => account.rate(current().id, -1));

video.addEventListener('click', () => {
  if (!current()) playOrPause();
});
video.addEventListener('resize', () => {
  if (video.videoWidth && video.videoHeight) {
    deck.style.setProperty('--video-ratio', String(video.videoWidth / video.videoHeight));
  }
});
video.addEventListener('loadeddata', () => {
  if (!current()) message.textContent = '';
});
video.addEventListener('play', render);
video.addEventListener('playing', () => {
  unavailable.delete(current().id);
  message.textContent = '';
  render();
});
video.addEventListener('pause', () => {
  if (video.paused && !video.ended && !video.error) message.textContent = '';
  render();
});
video.addEventListener('waiting', () => {
  if (!video.paused) message.textContent = 'Загружаем клип…';
});
video.addEventListener('ended', advance);
video.addEventListener('error', () => {
  const track = current() ?? history[0];
  if (track) unavailable.add(track.id);
  message.textContent = current()
    ? 'Клип недоступен. Попробуйте ещё раз или перейдите к следующему.'
    : 'Первый кадр не загрузился. Нажмите «Воспроизвести», чтобы попробовать снова.';
  render();
});

void loadCatalog();
