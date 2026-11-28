function range(min, max) {
  return min + Math.random() * (max - min);
}

function shade(hue, opacity) {
  return `hsl(${hue} 85% 66% / ${opacity})`;
}

function paintBackdrop(context, { width, height, bass, accent, mid, high, first, second }, time) {
  context.fillStyle = `hsl(${first} 42% ${8 + bass * 4}%)`;
  context.fillRect(0, 0, width, height);

  const span = Math.hypot(width, height);
  const left = width * (0.17 + Math.sin(time * 0.53) * 0.23);
  const right = width * (0.83 + Math.cos(time * 0.43) * 0.22);
  const upper = height * (0.32 + Math.cos(time * 0.48) * 0.28);
  const lower = height * (0.68 + Math.sin(time * 0.57) * 0.28);
  const primary = context.createRadialGradient(
    left,
    upper,
    0,
    left,
    upper,
    span * (0.62 + bass * 0.1),
  );
  primary.addColorStop(0, `hsl(${first} 86% 53% / ${0.44 + bass * 0.14 + accent * 0.08})`);
  primary.addColorStop(1, 'transparent');
  context.fillStyle = primary;
  context.fillRect(0, 0, width, height);

  const secondary = context.createRadialGradient(right, lower, 0, right, lower, span * 0.61);
  secondary.addColorStop(0, `hsl(${second} 78% 54% / ${0.37 + mid * 0.17 + high * 0.08})`);
  secondary.addColorStop(1, 'transparent');
  context.fillStyle = secondary;
  context.fillRect(0, 0, width, height);

  context.save();
  context.scale(width, height);
  const center = context.createRadialGradient(0.5, 0.5, 0, 0.5, 0.5, 0.5);
  center.addColorStop(0, '#141116bf');
  center.addColorStop(0.35, '#141116a6');
  center.addColorStop(1, '#14111600');
  context.fillStyle = center;
  context.fillRect(0, 0, 1, 1);
  context.restore();
}

function ribbons(context, { width, height, time, bass, accent }, scene) {
  const amplitude = height * (0.045 + bass * 0.1 + accent * 0.065);
  for (let line = 0; line < scene.count; line++) {
    const distance = (line / (scene.count - 1) - 0.5) * scene.span;
    const phase = scene.phase + time * scene.drift + line * scene.stagger;
    context.beginPath();
    for (let step = 0; step <= 56; step++) {
      const progress = step / 56;
      const x = progress * width;
      const offset = progress - 0.5;
      const wave = Math.sin(progress * scene.frequency + phase);
      const overtone = Math.cos(progress * scene.overtone - phase * 0.7) * scene.waveMix;
      const y =
        height * (scene.y + scene.tilt * offset + distance + scene.curve * (offset ** 2 - 0.1)) +
        (wave + overtone) * amplitude;
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
}

function arcs(context, { width, height, time, bass, accent }, scene) {
  const span = Math.hypot(width, height);
  for (const [index, ring] of scene.rings.entries()) {
    const proportion = (index + 1) / scene.rings.length;
    const radius = span * (0.07 + proportion ** scene.spacing * scene.span + bass * 0.05);
    const angle = ring.phase + time * scene.drift * (0.14 + proportion * 0.16);
    const x = width * (scene.x + Math.cos(angle) * ring.offset);
    const y = height * (scene.y + Math.sin(angle) * ring.offset);
    context.beginPath();
    context.ellipse(
      x,
      y,
      radius,
      radius * scene.aspect,
      scene.tilt + ring.tilt,
      angle,
      angle + Math.PI * (ring.length + accent * 0.34),
    );
    context.stroke();
  }
}

function position(point, width, height, time, scene) {
  const drift = time * scene.drift * point.speed;
  return [
    width * (point.x + Math.sin(point.phase + drift) * point.travel),
    height * (point.y + Math.cos(point.phase + drift * 0.72) * point.travel),
  ];
}

function dots(context, { width, height, time, bass, accent, high, first, second }, scene) {
  for (const point of scene.points) {
    const [x, y] = position(point, width, height, time, scene);
    context.fillStyle = shade(
      point.x < 0.5 ? first : second,
      0.34 + point.speed * 0.25 + high * 0.25,
    );
    context.beginPath();
    context.arc(x, y, point.size * (0.8 + bass * 0.8 + accent * 0.35 + high * 0.9), 0, Math.PI * 2);
    context.fill();
  }
}

function streaks(context, { width, height, time, accent, high }, scene) {
  const span = Math.min(width, height) * (0.033 + accent * 0.095 + high * 0.06);
  context.beginPath();
  for (const point of scene.points) {
    const [x, y] = position(point, width, height, time, scene);
    const heading = scene.tilt + Math.sin(point.phase + time * scene.drift) * 0.9;
    const length = span * (0.35 + point.size * 0.28);
    const dx = Math.cos(heading) * length;
    const dy = Math.sin(heading) * length;
    const bend = Math.sin(point.phase) * 0.72;
    context.moveTo(x, y);
    context.lineTo(x + dx, y + dy);
    context.lineTo(x + dx * 1.45 - dy * bend, y + dy * 1.45 + dx * bend);
  }
  context.stroke();
}

const renderers = [ribbons, arcs, dots, streaks];
const transition = 1800;

function pickRenderer(excluded) {
  const options = renderers.filter((render) => render !== excluded);
  return options[Math.floor(Math.random() * options.length)];
}

function createPoints(count) {
  const clusters = Array.from({ length: Math.floor(range(2, 5)) }, () => ({
    x: range(0.08, 0.92),
    y: range(0.08, 0.92),
    spread: range(0.08, 0.34),
  }));
  const density = range(0.25, 0.8);
  return Array.from({ length: count }, (_, index) => {
    const cluster = clusters[index % clusters.length];
    const angle = range(0, Math.PI * 2);
    const distance = Math.sqrt(Math.random()) * cluster.spread;
    const clustered = Math.random() < density;
    return {
      x: clustered ? cluster.x + Math.cos(angle) * distance : Math.random(),
      y: clustered ? cluster.y + Math.sin(angle) * distance : Math.random(),
      phase: range(0, Math.PI * 2),
      travel: range(0.008, 0.09),
      speed: range(0.35, 1.1),
      size: range(0.95, 3.2),
    };
  });
}

function createLayer(render, opacity) {
  const layer = {
    render,
    opacity,
    y: range(0.24, 0.76),
    drift: range(0.6, 1.4) * (Math.random() < 0.5 ? -1 : 1),
  };
  if (render === ribbons) {
    const frequency = range(3.8, 11.5);
    return {
      ...layer,
      count: Math.floor(range(5, 14)),
      span: range(0.16, 0.48),
      tilt: range(-0.7, 0.7),
      curve: range(-0.9, 0.9),
      phase: range(0, Math.PI * 2),
      frequency,
      overtone: frequency * range(1.6, 2.9),
      waveMix: range(0.14, 0.55),
      stagger: range(-0.65, 0.65),
    };
  }
  if (render === arcs) {
    return {
      ...layer,
      x: range(0.14, 0.86),
      span: range(0.19, 0.43),
      tilt: range(-1.2, 1.2),
      aspect: range(0.44, 0.95),
      spacing: range(0.65, 1.65),
      rings: Array.from({ length: Math.floor(range(6, 14)) }, () => ({
        phase: range(0, Math.PI * 2),
        offset: range(0.01, 0.13),
        tilt: range(-0.24, 0.24),
        length: range(0.28, 1.16),
      })),
    };
  }
  const count = Math.floor(render === dots ? range(56, 108) : range(22, 49));
  const points = createPoints(count);
  return render === dots
    ? { ...layer, points }
    : { ...layer, points, tilt: range(-Math.PI, Math.PI) };
}

function createScene(previous) {
  const primary = pickRenderer(previous?.primary.render);
  return {
    primary: createLayer(primary, 1),
    secondary: createLayer(pickRenderer(primary), range(0.25, 0.45)),
    duration: range(6100, 9900),
  };
}

export function createSoundscapeArt(context) {
  let current;
  let next;
  let elapsed = 0;
  let backdropTime = 0;

  function start() {
    current = createScene(current);
    next = createScene(current);
    elapsed = 0;
  }

  function paint(scene, data, opacity, time) {
    const { width, height, bass, accent, first, second } = data;
    const { primary, secondary } = scene;
    const gradient = context.createLinearGradient(
      0,
      height * primary.y,
      width,
      height * (1 - primary.y),
    );
    gradient.addColorStop(0, shade(first, 0.7 + accent * 0.18));
    gradient.addColorStop(0.52, shade(second, 0.63 + accent * 0.18));
    gradient.addColorStop(1, shade(first, 0.78 + accent * 0.18));

    context.save();
    context.strokeStyle = gradient;
    context.lineWidth = 1.25 + bass * 0.85 + accent * 0.75;
    const frame = { ...data, time: time / 1000 };
    context.globalAlpha = opacity * secondary.opacity;
    secondary.render(context, frame, secondary);
    context.globalAlpha = opacity * primary.opacity;
    primary.render(context, frame, primary);
    context.restore();
  }

  return {
    start,
    draw(delta, data) {
      elapsed += delta;
      backdropTime += delta / 1000;
      if (elapsed >= current.duration) {
        elapsed += transition - current.duration;
        current = next;
        next = createScene(current);
      }

      const progress = Math.max(0, 1 - (current.duration - elapsed) / transition);
      const mix = progress * progress * (3 - 2 * progress);
      paintBackdrop(context, data, backdropTime);
      paint(current, data, 1 - mix, elapsed);
      if (mix > 0) paint(next, data, mix, elapsed + transition - current.duration);
    },
  };
}
