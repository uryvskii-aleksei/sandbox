import { createSoundscapeArt } from './soundscape-art.mjs?v=3';

const genreHues = { electronic: 264, jazz: 202, folk: 141, 'hip-hop': 23, pop: 326 };

export function trackHue(clip) {
  let hash = 0;
  for (const character of clip.id) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  }
  const base = genreHues[clip.tags[0]] ?? hash % 360;
  return base + (hash % 61) - 30;
}

function bandEnergy(spectrum, hzPerBin, from, to) {
  const first = Math.ceil(from / hzPerBin);
  const end = Math.min(spectrum.length, Math.ceil(to / hzPerBin));
  let energy = 0;
  for (let bin = first; bin < end; bin++) {
    energy += (spectrum[bin] / 255) ** 2;
  }
  return Math.sqrt(energy / Math.max(1, end - first));
}

export function setupSoundscape(video, canvas, glow) {
  const Audio = window.AudioContext ?? window.webkitAudioContext;
  const graphics = canvas.getContext('2d');
  const art = graphics && createSoundscapeArt(graphics);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let audio;
  let analyser;
  let pending = false;
  let spectrum;
  let hzPerBin;
  let frame;
  let lastDraw = 0;
  let bass = 0;
  let floor = 0;
  let accent = 0;
  let palette = 330;
  let hue = palette;
  let playing = false;

  function cue(themeHue) {
    palette = themeHue;
    hue = palette;
    bass = floor = accent = 0;
    art?.start();
  }

  function draw(time) {
    frame = requestAnimationFrame(draw);
    if (time - lastDraw < 32) return;
    const delta = Math.min(70, time - lastDraw);
    lastDraw = time;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      graphics.setTransform(scale, 0, 0, scale, 0, 0);
    }

    analyser.getByteFrequencyData(spectrum);
    const low = bandEnergy(spectrum, hzPerBin, 40, 185);
    const mid = bandEnergy(spectrum, hzPerBin, 185, 2200);
    const high = bandEnergy(spectrum, hzPerBin, 2200, 8000);
    const brightness = (mid * 0.42 + high) / Math.max(0.14, low + mid + high);
    // Плавная огибающая передаёт общий бас, разница с недавним уровнем подчёркивает удары.
    bass += (low - bass) * 0.23;
    floor += (low - floor) * 0.065;
    accent = Math.min(1, Math.max(accent * 0.84, (low - floor - 0.04) * 4));
    hue += (palette + (brightness - 0.4) * 88 - hue) * 0.14;
    art.draw(delta, { width, height, bass, accent, mid, high, first: hue, second: hue + 58 });
    glow.style.setProperty('--glow-pulse', (bass * 0.35 + accent * 0.65).toFixed(3));
  }

  function sync() {
    const active =
      analyser &&
      audio.state === 'running' &&
      playing &&
      !video.muted &&
      video.volume > 0 &&
      !reduceMotion.matches &&
      !document.hidden;
    canvas.classList.toggle('is-playing', Boolean(active));
    if (!active) {
      cancelAnimationFrame(frame);
      frame = undefined;
      glow.style.removeProperty('--glow-pulse');
    } else if (frame === undefined) {
      lastDraw = performance.now();
      frame = requestAnimationFrame(draw);
    }
  }

  async function prepare() {
    try {
      audio ??= new Audio();
      if (audio.state !== 'running') await audio.resume();
      if (!analyser && audio.state === 'running' && !reduceMotion.matches) {
        const meter = audio.createAnalyser();
        meter.fftSize = 2048;
        meter.smoothingTimeConstant = 0.55;
        const source = audio.createMediaElementSource(video);
        source.connect(audio.destination);
        source.connect(meter);
        analyser = meter;
        spectrum = new Uint8Array(meter.frequencyBinCount);
        hzPerBin = audio.sampleRate / meter.fftSize;
        audio.addEventListener('statechange', sync);
      }
    } catch {
      // Браузер может оставить видеоплеер в обычном режиме, если Web Audio недоступен.
    } finally {
      pending = false;
      sync();
    }
  }

  function activate() {
    if (
      !Audio ||
      !graphics ||
      reduceMotion.matches ||
      pending ||
      (analyser && audio.state === 'running')
    )
      return;
    pending = true;
    void prepare();
  }

  video.addEventListener('playing', () => {
    playing = true;
    activate();
    sync();
  });
  for (const event of ['pause', 'waiting', 'ended', 'error', 'emptied']) {
    video.addEventListener(event, () => {
      playing = false;
      sync();
    });
  }
  video.addEventListener('volumechange', sync);
  document.addEventListener('visibilitychange', () => {
    if (playing && !document.hidden) activate();
    sync();
  });
  reduceMotion.addEventListener('change', () => {
    if (playing) activate();
    sync();
  });

  return { activate, cue };
}
