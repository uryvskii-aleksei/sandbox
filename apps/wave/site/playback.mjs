export function watchedSeconds(ranges) {
  let total = 0;
  for (let index = 0; index < ranges.length; index++) {
    total += ranges.end(index) - ranges.start(index);
  }
  return total;
}

export function playbackSignal(outcome, watched, duration) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(watched)) return 0;
  if (outcome === 'ended') return watched >= duration * 0.85 ? 1 : 0;
  return outcome === 'skip' && watched >= 1 && watched <= Math.min(10, duration * 0.5) ? -1 : 0;
}

export function createPlaybackProgress() {
  const ranges = [];
  let previous;

  return {
    sample(position, now) {
      if (!Number.isFinite(position) || position < 0) return;
      const last = previous;
      previous = { position, now };
      if (!last || position <= last.position) return;
      // Плеер присылает позиции с разными интервалами. Скачок времени не считается просмотром.
      if (position - last.position > Math.min(5, (now - last.now) * 0.003 + 0.75)) return;

      let start = last.position;
      let end = position;
      const first = ranges.findIndex((range) => range.end >= start);
      if (first < 0) {
        ranges.push({ start, end });
        return;
      }
      let index = first;
      while (index < ranges.length && ranges[index].start <= end) {
        start = Math.min(start, ranges[index].start);
        end = Math.max(end, ranges[index].end);
        index++;
      }
      ranges.splice(first, index - first, { start, end });
    },
    interrupt() {
      previous = undefined;
    },
    get watched() {
      return ranges.reduce((total, { start, end }) => total + end - start, 0);
    },
  };
}
