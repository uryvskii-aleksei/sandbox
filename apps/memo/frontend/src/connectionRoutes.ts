import type { Card, CardLink } from './types';

type Point = Card['coordinates'];
export type Block = Point & { id: number; width: number; height: number };
type Rect = { left: number; top: number; right: number; bottom: number };
type Segment = { from: Point; to: Point };
type Endpoint = { at: Point; direction?: Point };
type Cubic = [from: Point, first: Point, second: Point, to: Point];

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const between = (a: Point, b: Point, ratio: number): Point => ({
  x: a.x + (b.x - a.x) * ratio,
  y: a.y + (b.y - a.y) * ratio,
});
const rect = (block: Block, padding = 0): Rect => ({
  left: block.x - padding,
  top: block.y - padding,
  right: block.x + block.width + padding,
  bottom: block.y + block.height + padding,
});
const inside = (p: Point, r: Rect) =>
  p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
const closeTo = (a: Point, b: Point) => distance(a, b) < 0.01;
const linkKey = ({ source, target }: CardLink) => source + ':' + target;

export function linkPort(block: Block, output: boolean, offset = 0): Endpoint {
  return {
    at: { x: block.x + block.width / 2 + offset, y: block.y + (output ? block.height : 0) },
    direction: { x: 0, y: output ? 1 : -1 },
  };
}

const leadFrom = ({ at, direction }: Endpoint, length: number): Point => ({
  x: at.x + (direction?.x ?? 0) * length,
  y: at.y + (direction?.y ?? 0) * length,
});

function portionInRect(a: Point, b: Point, r: Rect) {
  let enter = 0;
  let leave = 1;
  for (const [from, to, min, max] of [
    [a.x, b.x, r.left, r.right],
    [a.y, b.y, r.top, r.bottom],
  ]) {
    if (from === to) {
      if (from <= min || from >= max) return 0;
      continue;
    }
    const first = (min - from) / (to - from);
    const last = (max - from) / (to - from);
    enter = Math.max(enter, Math.min(first, last));
    leave = Math.min(leave, Math.max(first, last));
  }
  return Math.max(0, leave - enter);
}
const entersRect = (a: Point, b: Point, r: Rect) => portionInRect(a, b, r) > 0.000001;

const signedArea = (a: Point, b: Point, p: Point) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const sharedX =
    Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
  const sharedY =
    Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  if (sharedX < 0 || sharedY < 0) return false;

  const first = signedArea(a, b, c);
  const last = signedArea(a, b, d);
  const from = signedArea(c, d, a);
  const to = signedArea(c, d, b);
  if (first === 0 && last === 0 && from === 0 && to === 0) return sharedX > 0.01 || sharedY > 0.01;
  return first * last <= 0 && from * to <= 0;
}

const pathsCross = (path: Segment[], others: Segment[]) =>
  path.some(({ from, to }) =>
    others.some((segment) => segmentsCross(from, to, segment.from, segment.to)),
  );

function trafficCost(a: Point, b: Point, traffic: Segment[]) {
  const length = distance(a, b);
  if (length < 1) return 0;
  let cost = 0;
  for (const { from, to } of traffic) {
    if (
      Math.max(a.x, b.x) + 30 < Math.min(from.x, to.x) ||
      Math.max(from.x, to.x) + 30 < Math.min(a.x, b.x) ||
      Math.max(a.y, b.y) + 30 < Math.min(from.y, to.y) ||
      Math.max(from.y, to.y) + 30 < Math.min(a.y, b.y)
    )
      continue;
    if (segmentsCross(a, b, from, to)) cost += 640;
    const span = distance(from, to);
    if (!span) continue;
    const relative = (p: Point) => ({
      x: ((p.x - from.x) * (to.x - from.x) + (p.y - from.y) * (to.y - from.y)) / span,
      y: signedArea(from, to, p) / span,
    });
    const start = relative(a);
    const end = relative(b);
    cost +=
      length *
      (portionInRect(start, end, { left: 0, right: span, top: -30, bottom: 30 }) +
        3 * portionInRect(start, end, { left: 0, right: span, top: -12, bottom: 12 }));
  }
  return cost;
}

function shortestPath(
  a: Point,
  b: Point,
  obstacles: Rect[],
  traffic: Segment[],
  detour?: Point[],
): Point[] | null {
  if (obstacles.some((r) => inside(a, r) || inside(b, r))) return null;
  const active = new Set(obstacles.filter((r) => entersRect(a, b, r)));
  const directCost = detour ? 0 : trafficCost(a, b, traffic);
  if (!active.size && !directCost && (!detour || !pathsCross([{ from: a, to: b }], traffic)))
    return [a, b];

  const length = distance(a, b);
  const guides =
    directCost && length
      ? [-96, -40, 40, 96].flatMap((offset) =>
          [0.25, 0.75].map((ratio) => {
            const p = between(a, b, ratio);
            return {
              x: p.x - (offset * (b.y - a.y)) / length,
              y: p.y + (offset * (b.x - a.x)) / length,
            };
          }),
        )
      : [];
  // Добавляем препятствия по мере необходимости. Так удалённые блоки не раздувают граф видимости.
  for (;;) {
    const rects = [...active];
    const corners = rects.flatMap(({ left, top, right, bottom }) =>
      (traffic.length ? [0, 20] : [0]).flatMap((gap) => [
        { x: left - gap, y: top - gap },
        { x: right + gap, y: top - gap },
        { x: left - gap, y: bottom + gap },
        { x: right + gap, y: bottom + gap },
      ]),
    );
    const candidates = [...corners, ...guides, ...(detour ?? [])].filter(
      (p) => !rects.some((r) => inside(p, r)),
    );
    const nodes = [a, b, ...candidates];
    const previous = nodes.map(() => -1);
    const costs = nodes.map((_, index) => (index === 0 ? 0 : Infinity));
    const visited = new Set<number>();
    for (;;) {
      let next = -1;
      let best = Infinity;
      for (const [index, cost] of costs.entries()) {
        if (visited.has(index)) continue;
        const estimate = cost + distance(nodes[index], b);
        if (estimate < best) {
          best = estimate;
          next = index;
        }
      }
      if (next < 0) return null;
      if (next === 1) break;
      visited.add(next);
      const from = nodes[next];
      for (const [index, to] of nodes.entries()) {
        if (visited.has(index) || rects.some((r) => entersRect(from, to, r))) continue;
        if (detour && pathsCross([{ from, to }], traffic)) continue;
        const total =
          costs[next] + distance(from, to) + (detour ? 0 : trafficCost(from, to, traffic));
        if (total < costs[index]) {
          costs[index] = total;
          previous[index] = next;
        }
      }
    }
    const path: Point[] = [];
    for (let index = 1; index >= 0; index = previous[index]) path.push(nodes[index]);
    path.reverse();
    const before = active.size;
    for (const [index, from] of path.slice(0, -1).entries()) {
      for (const r of obstacles) {
        if (entersRect(from, path[index + 1], r)) active.add(r);
      }
    }
    if (active.size === before) return path;
  }
}

function polyline(
  start: Endpoint,
  end: Endpoint,
  blocks: Block[],
  traffic: Segment[],
  detour?: Point[],
) {
  const bare = blocks.map((block) => rect(block));
  const room = start.direction && end.direction ? Math.min(80, distance(start.at, end.at) / 3) : 0;
  const approach = (port: Endpoint, other: Endpoint, minimum: number) => {
    const direction = port.direction;
    const facesAway =
      direction &&
      direction.x * (other.at.x - port.at.x) + direction.y * (other.at.y - port.at.y) <= 0;
    const extra = facesAway ? Math.max(0, room - minimum) : 0;
    for (const portion of extra ? [1, 0.67, 0.33, 0] : [0]) {
      const at = leadFrom(port, minimum + portion * extra);
      if (bare.some((r) => entersRect(port.at, at, r))) continue;
      if ((portion || detour) && pathsCross([{ from: port.at, to: at }], traffic)) continue;
      return at;
    }
    return null;
  };
  for (const padding of [24, 12, 4, 0]) {
    const a = approach(start, end, padding + 8);
    const b = approach(end, start, padding + 8);
    if (!a || !b) continue;
    const obstacles = blocks.map((block, index) => {
      const padded = rect(block, padding);
      return inside(a, padded) || inside(b, padded) ? bare[index] : padded;
    });
    const path = shortestPath(a, b, obstacles, traffic, detour);
    if (path) return [start.at, ...path, end.at];
  }
  // Если карточки перекрывают порт, у связи может не быть прохода.
  return [start.at, end.at];
}

function midpoint(points: Point[]): Point {
  const lengths = points.slice(1).map((p, index) => distance(points[index], p));
  let remaining = lengths.reduce((total, length) => total + length, 0) / 2;
  for (const [index, length] of lengths.entries()) {
    if (remaining <= length && length > 0)
      return between(points[index], points[index + 1], remaining / length);
    remaining -= length;
  }
  return points[0];
}

const xy = ({ x, y }: Point) => x.toFixed(2) + ' ' + y.toFixed(2);

function curveClears(curve: Cubic, obstacles: Rect[], depth = 6): boolean {
  const left = Math.min(...curve.map((p) => p.x));
  const right = Math.max(...curve.map((p) => p.x));
  const top = Math.min(...curve.map((p) => p.y));
  const bottom = Math.max(...curve.map((p) => p.y));
  const nearby = obstacles.filter(
    (r) => left < r.right && right > r.left && top < r.bottom && bottom > r.top,
  );
  if (!nearby.length) return true;
  if (!depth) return false;

  // После деления выпуклые оболочки половин точнее описывают занимаемое кривой место.
  const [from, first, second, to] = curve;
  const a = between(from, first, 0.5);
  const b = between(first, second, 0.5);
  const c = between(second, to, 0.5);
  const d = between(a, b, 0.5);
  const e = between(b, c, 0.5);
  const middle = between(d, e, 0.5);
  return (
    curveClears([from, a, d, middle], nearby, depth - 1) &&
    curveClears([middle, e, c, to], nearby, depth - 1)
  );
}

function sampleCurve([from, first, second, to]: Cubic) {
  const length = distance(from, first) + distance(first, second) + distance(second, to);
  const steps = Math.max(8, Math.min(24, Math.ceil(length / 28)));
  return Array.from({ length: steps }, (_, index) => {
    const t = (index + 1) / steps;
    const a = between(from, first, t);
    const b = between(first, second, t);
    const c = between(second, to, t);
    return between(between(a, b, t), between(b, c, t), t);
  });
}

const segmentsOf = (points: Point[]): Segment[] =>
  points.slice(1).map((to, index) => ({ from: points[index], to }));

function roundCorner(
  before: Point,
  at: Point,
  after: Point,
  obstacles: Rect[],
  traffic: Segment[],
  terminal: { first: boolean; last: boolean },
) {
  const incoming = distance(at, before);
  const outgoing = distance(at, after);
  const cosine =
    ((at.x - before.x) * (after.x - at.x) + (at.y - before.y) * (after.y - at.y)) /
    (incoming * outgoing);
  const turn = Math.acos(Math.max(-1, Math.min(1, cosine)));
  if (turn < 0.01 || Math.PI - turn < 0.01) return null;
  const tangent = (4 * Math.tan(turn / 4)) / (3 * Math.tan(turn / 2));
  // Первый и последний отрезки можно использовать целиком для поворота у порта.
  const radius = Math.min(
    100,
    terminal.first ? incoming : incoming / 2,
    terminal.last ? outgoing : outgoing / 2,
  );
  for (const factor of [1, 0.8, 0.6, 0.45, 0.3, 0.18, 0.1]) {
    const trim = radius * factor;
    const a = between(at, before, trim / incoming);
    const b = between(at, after, trim / outgoing);
    const curve: Cubic = [a, between(a, at, tangent), between(b, at, tangent), b];
    if (!curveClears(curve, obstacles)) continue;
    if (
      traffic.length &&
      pathsCross(segmentsOf([a, ...sampleCurve(curve)]), traffic) &&
      !pathsCross(segmentsOf([a, at, b]), traffic)
    )
      continue;
    return curve;
  }
  return null;
}

function directCurve(
  start: Endpoint,
  end: Endpoint,
  bounds: Rect[],
  traffic: Segment[],
): Cubic | null {
  if (!start.direction || !end.direction) return null;
  const dx = end.at.x - start.at.x;
  const dy = end.at.y - start.at.y;
  if (
    dx * start.direction.x + dy * start.direction.y <= 0 ||
    dx * end.direction.x + dy * end.direction.y >= 0
  )
    return null;
  const vertical = start.direction.x === 0 && end.direction.x === 0;
  const span = vertical ? Math.abs(dy) : Math.hypot(dx, dy);
  for (const factor of [0.56, 0.4, 0.24]) {
    const lead = Math.min(230, span * factor);
    const curve: Cubic = [start.at, leadFrom(start, lead), leadFrom(end, lead), end.at];
    if (!curveClears(curve, bounds)) continue;
    if (!traffic.length || !pathsCross(segmentsOf([start.at, ...sampleCurve(curve)]), traffic))
      return curve;
  }
  return null;
}

function overlapPorts(
  source: Block,
  target: Block,
  preferredStart: Endpoint,
  preferredEnd: Endpoint,
  bounds: Rect[],
  traffic: Segment[],
) {
  const a = rect(source);
  const b = rect(target);
  if (a.left >= b.right || a.right <= b.left || a.top >= b.bottom || a.bottom <= b.top)
    return { start: preferredStart, end: preferredEnd };

  const exposed = (own: Rect, other: Rect, preferred: Endpoint) => {
    const inset = 24;
    const positions = (low: number, high: number, blockLow: number, blockHigh: number) => [
      ...new Set(
        [(blockLow + blockHigh) / 2, blockLow - inset, blockHigh + inset].map((at) =>
          Math.max(low + inset, Math.min(high - inset, at)),
        ),
      ),
    ];
    return [
      preferred,
      ...positions(own.left, own.right, other.left, other.right).flatMap((x) => [
        { at: { x, y: own.top }, direction: { x: 0, y: -1 } },
        { at: { x, y: own.bottom }, direction: { x: 0, y: 1 } },
      ]),
      ...positions(own.top, own.bottom, other.top, other.bottom).flatMap((y) => [
        { at: { x: own.left, y }, direction: { x: -1, y: 0 } },
        { at: { x: own.right, y }, direction: { x: 1, y: 0 } },
      ]),
    ].filter((port) => !bounds.some((r) => entersRect(port.at, leadFrom(port, 4), r)));
  };

  const starts = exposed(a, b, preferredStart);
  const ends = exposed(b, a, preferredEnd);
  let bestCurve = Infinity;
  let bestPair = Infinity;
  let curved: { start: Endpoint; end: Endpoint } | null = null;
  let nearby = { start: preferredStart, end: preferredEnd };
  for (const start of starts) {
    for (const end of ends) {
      const gap = distance(start.at, end.at);
      // Короткий участок должен оставаться виден рядом с кнопкой связи на карточке.
      const score =
        gap +
        2 * Math.max(0, 34 - gap) +
        0.18 * (distance(start.at, preferredStart.at) + distance(end.at, preferredEnd.at));
      if (score < bestPair) {
        bestPair = score;
        nearby = { start, end };
      }
      if (score < bestCurve && directCurve(start, end, bounds, traffic)) {
        bestCurve = score;
        curved = { start, end };
      }
    }
  }
  return curved ?? nearby;
}

function detourGuides(samples: Point[]) {
  const clearance = 24;
  const left = Math.min(...samples.map(({ x }) => x)) - clearance;
  const right = Math.max(...samples.map(({ x }) => x)) + clearance;
  const top = Math.min(...samples.map(({ y }) => y)) - clearance;
  const bottom = Math.max(...samples.map(({ y }) => y)) + clearance;
  const stride = Math.max(1, Math.ceil(samples.length / 12));
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
    ...samples
      .filter((_, index) => index % stride === 0 || index === samples.length - 1)
      .flatMap(({ x, y }) => [
        { x: x - clearance, y },
        { x: x + clearance, y },
        { x, y: y - clearance },
        { x, y: y + clearance },
      ]),
  ];
}

export function routeConnection(
  start: Endpoint,
  end: Endpoint,
  blocks: Block[],
  traffic: Segment[] = [],
  detour?: Point[],
) {
  const commands = ['M' + xy(start.at)];
  const samples = [start.at];
  const line = (to: Point) => {
    if (closeTo(samples[samples.length - 1], to)) return;
    commands.push('L' + xy(to));
    samples.push(to);
  };
  const curve = (section: Cubic) => {
    line(section[0]);
    commands.push('C' + section.slice(1).map(xy).join(' '));
    samples.push(...sampleCurve(section));
  };
  const bounds = blocks.map((block) => rect(block));
  const direct = directCurve(start, end, bounds, traffic);
  if (direct) {
    curve(direct);
  } else {
    const vertices = polyline(start, end, blocks, traffic, detour).filter(
      (at, index, all) => index === 0 || !closeTo(at, all[index - 1]),
    );
    for (let index = 1; index < vertices.length - 1; index++) {
      const at = vertices[index];
      const rounding = roundCorner(vertices[index - 1], at, vertices[index + 1], bounds, traffic, {
        first: index === 1 && Boolean(start.direction),
        last: index === vertices.length - 2 && Boolean(end.direction),
      });
      if (rounding) curve(rounding);
      else line(at);
    }
    line(end.at);
  }
  return {
    d: commands.join(' '),
    start: start.at,
    end: end.at,
    center: midpoint(samples),
    samples,
    segments: segmentsOf(samples),
  };
}

export function routeBoardLinks(links: CardLink[], blocks: Block[]) {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const visible = links.filter((link) => byId.has(link.source) && byId.has(link.target));
  const ports = (id: number, output: boolean, link: CardLink) => {
    const block = byId.get(id);
    if (!block) return null;
    const others = visible
      .filter((item) => (output ? item.source : item.target) === id)
      .map((item) => ({ item, x: byId.get(output ? item.target : item.source)?.x ?? 0 }))
      .sort((a, b) => a.x - b.x || a.item.source - b.item.source || a.item.target - b.item.target);
    const spacing = Math.min(24, (block.width - 48) / Math.max(1, others.length - 1));
    return linkPort(
      block,
      output,
      (others.findIndex(({ item }) => item === link) - (others.length - 1) / 2) * spacing,
    );
  };
  let plan = visible.flatMap((link) => {
    const start = ports(link.source, true, link);
    const end = ports(link.target, false, link);
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    return start && end && source && target ? [{ start, end, source, target, link }] : [];
  });
  const bounds = blocks.map((block) => rect(block));
  const draw = (items: typeof plan) => {
    const traffic: Segment[] = [];
    return items.map(({ start, end, source, target, link }) => {
      const ports = overlapPorts(source, target, start, end, bounds, traffic);
      const route = routeConnection(ports.start, ports.end, blocks, traffic);
      traffic.push(...route.segments);
      return { key: linkKey(link), link, ...route };
    });
  };
  const intersections = (routes: ReturnType<typeof draw>) =>
    routes.flatMap(({ segments }, i) =>
      routes
        .slice(i + 1)
        .flatMap((other, offset) =>
          pathsCross(segments, other.segments) ? [[i, i + 1 + offset]] : [],
        ),
    );
  const alternatives = (i: number, j: number) => {
    const a = plan[i];
    const b = plan[j];
    const reordered = [...plan];
    reordered[i] = b;
    reordered[j] = a;
    const side =
      a.link.source === b.link.source ? 'start' : a.link.target === b.link.target ? 'end' : null;
    if (!side) return [reordered];
    const swappedPorts = [...plan];
    swappedPorts[i] = { ...a, [side]: b[side] };
    swappedPorts[j] = { ...b, [side]: a[side] };
    return [swappedPorts, reordered];
  };
  let routes = draw(plan);
  let crossings = intersections(routes);
  if (!crossings.length) return routes;

  const attemptLimit = 6;
  let attempts = 0;
  // Другой порядок портов или расчёта связей может освободить проход.
  while (crossings.length && attempts < attemptLimit) {
    let improved = false;
    for (const [i, j] of crossings) {
      for (const next of alternatives(i, j)) {
        if (attempts >= attemptLimit) break;
        attempts += 1;
        const candidate = draw(next);
        const remaining = intersections(candidate);
        if (remaining.length >= crossings.length) continue;
        plan = next;
        routes = candidate;
        crossings = remaining;
        improved = true;
        break;
      }
      if (improved || attempts >= attemptLimit) break;
    }
    if (!improved) break;
  }

  let remainingDetours = attemptLimit;
  // Если смена порядка не помогла, ищем обход по обе стороны уже проведённой линии.
  while (crossings.length && remainingDetours > 0) {
    let rerouted = false;
    for (const pair of crossings) {
      for (const index of pair) {
        if (remainingDetours-- <= 0) break;
        const { start, end, source, target, link } = plan[index];
        const traffic = routes.flatMap(({ segments }, other) => (index === other ? [] : segments));
        const blocker = routes[index === pair[0] ? pair[1] : pair[0]];
        const ports = overlapPorts(source, target, start, end, bounds, traffic);
        const candidate = routeConnection(
          ports.start,
          ports.end,
          blocks,
          traffic,
          detourGuides(blocker.samples),
        );
        if (
          pathsCross(candidate.segments, traffic) ||
          candidate.segments.some(({ from, to }) => bounds.some((r) => entersRect(from, to, r)))
        )
          continue;
        routes[index] = { key: linkKey(link), link, ...candidate };
        crossings = crossings.filter((pair) => !pair.includes(index));
        rerouted = true;
        break;
      }
      if (rerouted || remainingDetours <= 0) break;
    }
    if (!rerouted) break;
  }

  const byLink = new Map(routes.map((route) => [route.link, route]));
  return visible.flatMap((link) => {
    const route = byLink.get(link);
    return route ? [route] : [];
  });
}
