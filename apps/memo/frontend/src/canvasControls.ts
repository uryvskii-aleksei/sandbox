const owners = '.mind-card,[data-menu-mark],.connection-control';
const bodies =
  '.mind-card,.mark-stroke[data-mark-id]:not(line),.canvas-label-item,.shape-caption-text,.connection-label';
const controlsReach = 38;

export function nearbyControls(
  board: HTMLElement,
  target: EventTarget | null,
  clientX: number,
  clientY: number,
  scale: number,
  world: { x: number; y: number },
): Element | null {
  if (!(target instanceof Element) || !board.contains(target)) return null;
  const direct = target.closest(owners);
  if (direct || target !== board) return direct;

  const reach = controlsReach * scale;
  const separation = (element: Element) => {
    const { left, right, top, bottom, width } = element.getBoundingClientRect();
    if (element instanceof SVGCircleElement) {
      const radius = width / 2;
      return Math.max(0, Math.hypot(clientX - left - radius, clientY - top - radius) - radius);
    }
    return Math.hypot(
      Math.max(left - clientX, clientX - right, 0),
      Math.max(top - clientY, clientY - bottom, 0),
    );
  };
  let nearest: Element | null = null;
  let best = reach;
  for (const body of board.querySelectorAll(bodies)) {
    const distance = separation(body);
    if (distance >= best) continue;
    nearest = body.closest(owners);
    best = distance;
  }
  if (nearest) return nearest;

  for (const line of board.querySelectorAll<SVGGeometryElement>('.canvas-controls-range')) {
    if (separation(line) > reach || !line.isPointInStroke(world)) continue;
    const labelId = line.getAttribute('data-link-label');
    return labelId
      ? (board.ownerDocument.getElementById(labelId)?.closest(owners) ?? null)
      : line.closest(owners);
  }
  return null;
}
