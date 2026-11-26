function similarity(clip, rated) {
  const sharedTags = clip.tags.filter((tag) => rated.tags.includes(tag)).length;
  return (
    0.8 * (sharedTags / Math.max(clip.tags.length, rated.tags.length)) +
    (clip.artist === rated.artist ? 0.65 : 0)
  );
}

export function pickClip(catalog, ratings, recent, unavailable, random = Math.random) {
  const available = catalog.filter((clip) => !unavailable.has(clip.id));
  if (!available.length) return null;

  const excluded = recent.slice(-5);
  const fresh = available.filter((clip) => !excluded.includes(clip.id));
  const withoutCurrent = available.filter((clip) => clip.id !== recent.at(-1));
  const candidates = fresh.length ? fresh : withoutCurrent.length ? withoutCurrent : available;
  const ratedClips = catalog.filter((clip) => ratings[clip.id] === 1 || ratings[clip.id] === -1);

  const weights = candidates.map((clip) => {
    const affinity = ratedClips.reduce(
      (sum, rated) => sum + similarity(clip, rated) * ratings[rated.id],
      0,
    );
    const clipRating = ratings[clip.id];
    const directWeight = clipRating === -1 ? 0.12 : clipRating === 1 ? 1.35 : 1;
    // Ограничиваем влияние оценок, чтобы в подборке оставались разные стили.
    return Math.exp(Math.min(2.3, Math.max(-2.3, affinity))) * directWeight;
  });
  let remaining = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, weight] of weights.entries()) {
    remaining -= weight;
    if (remaining < 0) return candidates[index];
  }
  return candidates.at(-1);
}
