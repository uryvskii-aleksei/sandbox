function range(min, max) {
  return min + Math.random() * (max - min);
}

function shade(hue, opacity) {
  return `hsl(${hue} 85% 66% / ${opacity})`;
}

function ribbons(context, { width, height, time, bass, accent }, scene) {
  const amplitude = height * (0.035 + bass * 0.075 + accent * 0.052);
  for (let line = 0; line < scene.count; line++) {
    const distance = (line / (scene.count - 1) - 0.5) * scene.span;
    context.beginPath();
    for (let step = 0; step <= 56; step++) {
      const progress = step / 56;
      const x = progress * width;
      const offset = progress - 0.5;
      const ripple =
        Math.sin(progress * scene.frequency + scene.phase + time * scene.drift + line * 0.24) *
        amplitude;
      const y =
        height * (scene.y + scene.tilt * offset + distance + scene.curve * (offset ** 2 - 0.1)) +
        ripple;
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
}

function arcs(context, { width, height, time, bass, accent }, scene) {
  const x = width * scene.x;
  const y = height * scene.y;
  const span = Math.hypot(width, height);
  for (let index = 0; index < scene.count; index++) {
    const proportion = (index + 1) / scene.count;
    const radius = span * (0.09 + proportion * scene.span + bass * 0.04);
    const angle =
      scene.phase + index * scene.curve + time * scene.drift * (0.12 + proportion * 0.06);
    context.beginPath();
    context.ellipse(
      x,
      y,
      radius,
      radius * (0.42 + scene.frequency * 0.045),
      scene.tilt,
      angle,
      angle + Math.PI * (0.32 + accent * 0.28 + (index % 3) * 0.23),
    );
    context.stroke();
  }
}

function position(point, width, height, time, scene) {
  const drift = time * scene.drift;
  return [
    width * (point.x + Math.sin(point.phase + drift * point.speed) * point.travel),
    height * (point.y + Math.cos(point.phase + drift * point.speed * 0.72) * point.travel),
  ];
}

function dots(context, { width, height, time, bass, high, first, second }, scene) {
  for (const point of scene.points) {
    const [x, y] = position(point, width, height, time, scene);
    context.fillStyle = shade(
      point.x < scene.x ? first : second,
      0.16 + point.speed * 0.18 + high * 0.2,
    );
    context.beginPath();
    context.arc(x, y, point.size * (0.7 + bass * 0.8 + high * 0.9), 0, Math.PI * 2);
    context.fill();
  }
}

function streaks(context, { width, height, time, accent, high }, scene) {
  const span = Math.min(width, height) * (0.025 + accent * 0.07 + high * 0.04);
  context.beginPath();
  for (const point of scene.points) {
    const [x, y] = position(point, width, height, time, scene);
    const heading = scene.tilt * 2.3 + Math.sin(point.phase + time * scene.drift) * scene.curve;
    const dx = Math.cos(heading) * span * point.speed;
    const dy = Math.sin(heading) * span * point.speed;
    context.moveTo(x, y);
    context.lineTo(x + dx, y + dy);
    context.lineTo(x + dx * 1.4 - dy * 0.35, y + dy * 1.4 + dx * 0.35);
  }
  context.stroke();
}

const renderers = [ribbons, arcs, dots, streaks];
const transition = 1800;

export function createSoundscapeArt(context) {
  let remaining = [...renderers];
  let lastOpening;
  let current;
  let next;
  let elapsed = 0;

  function createScene(excluded) {
    const alternatives = remaining.filter((render) => render !== excluded);
    if (!alternatives.length) remaining = renderers.filter((render) => render !== excluded);
    const options = alternatives.length ? alternatives : remaining;
    const render = options[Math.floor(Math.random() * options.length)];
    remaining = remaining.filter((candidate) => candidate !== render);
    if (!remaining.length) remaining = [...renderers];
    const pointCount = render === dots ? range(56, 108) : render === streaks ? range(22, 49) : 0;
    const points = Array.from({ length: Math.floor(pointCount) }, () => ({
      x: Math.random(),
      y: Math.random(),
      phase: range(0, Math.PI * 2),
      travel: range(0.008, 0.09),
      speed: range(0.35, 1.1),
      size: range(0.65, 2.4),
    }));
    return {
      render,
      points,
      count: Math.floor(range(6, 14)),
      duration: range(6100, 9900),
      phase: range(0, Math.PI * 2),
      x: range(0.12, 0.88),
      y: range(0.27, 0.75),
      tilt: range(-0.75, 0.75),
      curve: range(-0.6, 0.6),
      frequency: range(3.8, 11.5),
      drift: range(-0.8, 0.8),
      span: range(0.15, 0.42),
    };
  }

  function start() {
    current = createScene(lastOpening);
    lastOpening = current.render;
    next = createScene(current.render);
    elapsed = 0;
  }

  function paint(scene, data, opacity, time) {
    const { width, height, bass, accent, first, second } = data;
    const x = width * scene.x;
    const y = height * scene.y;
    const glow = context.createRadialGradient(x, y, 0, x, y, Math.hypot(width, height) * 0.7);
    glow.addColorStop(0, shade(first, 0.19 + bass * 0.14));
    glow.addColorStop(0.55, shade(second, 0.045 + bass * 0.04));
    glow.addColorStop(1, 'transparent');
    const gradient = context.createLinearGradient(
      0,
      height * scene.y,
      width,
      height * (1 - scene.y),
    );
    gradient.addColorStop(0, shade(first, 0.38 + accent * 0.18));
    gradient.addColorStop(0.52, shade(second, 0.16));
    gradient.addColorStop(1, shade(first, 0.46 + accent * 0.17));

    context.save();
    context.globalAlpha = opacity;
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = gradient;
    context.lineWidth = 1.1;
    scene.render(context, { ...data, time: time / 1000 }, scene);
    context.restore();
  }

  return {
    start,
    draw(delta, data) {
      elapsed += delta;
      if (elapsed >= current.duration) {
        elapsed += transition - current.duration;
        current = next;
        next = createScene(current.render);
      }

      const progress = Math.max(0, 1 - (current.duration - elapsed) / transition);
      const mix = progress * progress * (3 - 2 * progress);
      context.clearRect(0, 0, data.width, data.height);
      paint(current, data, 1 - mix, elapsed);
      if (mix > 0) paint(next, data, mix, elapsed + transition - current.duration);
    },
  };
}
