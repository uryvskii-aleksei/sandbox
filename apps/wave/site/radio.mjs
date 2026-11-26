import { setupAccount } from './account.mjs';
import { pickClip } from './selection.mjs';
import { setupSoundscape } from './soundscape.mjs';

const get = (id) => document.getElementById(id);
const panel = get('deck-panel');
const station = panel.parentElement;
const toggle = get('toggle');
const previous = get('previous');
const next = get('next');
const like = get('like');
const dislike = get('dislike');
const splash = get('splash');
const video = get('video');
const soundscape = setupSoundscape(video, get('soundscape'));
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
  const pause = !video.paused && !video.ended && !video.error;
  const label = pause ? 'Пауза' : 'Воспроизвести';
  get('toggle-icon').className = 'symbol ' + (pause ? 'pause' : 'play');
  toggle.setAttribute('aria-label', label);
  toggle.dataset.tooltip = label + ' · Пробел';
  panel.inert = !clip;
  toggle.disabled = splash.disabled = !catalog.length && !catalogFailed;
  previous.disabled = position <= 0;
  next.disabled = !clip;
  like.disabled = dislike.disabled = !clip || account.busy;
  like.setAttribute('aria-pressed', String(account.ratings[clip?.id] === 1));
  dislike.setAttribute('aria-pressed', String(account.ratings[clip?.id] === -1));
  trackDetails.hidden = !clip;
  if (clip) {
    get('track-artist').textContent = clip.artist;
    get('track-title').textContent = clip.title;
    get('clip-credit').textContent = clip.credit;
    source.href = clip.source;
    video.setAttribute('aria-label', clip.artist + ' — ' + clip.title);
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

function show(clip) {
  const posterHadFocus = document.activeElement === splash;
  splash.hidden = true;
  video.hidden = false;
  message.textContent = 'Загружаем клип…';
  const hue = soundscape.cue(clip);
  const root = document.documentElement;
  root.style.setProperty('--accent', `hsl(${hue} 88% 72%)`);
  root.classList.add('has-clip');
  video.src = clip.video;
  play();
  if (posterHadFocus) toggle.focus({ preventScroll: true });
}

function advance() {
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
  show(current());
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
    catalog = clips;
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
  if ((space || arrow) && target === video) return;
  if (space && target.closest('button, a[href]')) return;

  const button = space ? (current() ? toggle : splash) : shortcuts.get(event.code);
  if (!button || button.disabled || button.hidden) return;
  event.preventDefault();
  button.click();
});

trackDetails.addEventListener('click', () => clipDetails.showModal());
splash.addEventListener('click', playOrPause);
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
  unavailable.add(current().id);
  message.textContent = 'Клип недоступен. Попробуйте ещё раз или перейдите к следующему.';
  render();
});

function measurePanel() {
  station.style.setProperty('--panel-height', panel.getBoundingClientRect().height + 'px');
}

measurePanel();
new ResizeObserver(measurePanel).observe(panel);
void loadCatalog();
