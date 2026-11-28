const genres = new Set([
  'pop',
  'rock',
  'metal',
  'indie',
  'hip-hop',
  'electronic',
  'folk',
  'jazz',
  'blues',
  'classical',
  'chanson',
]);

export function clipGenre(clip) {
  return clip.tags.find((tag) => genres.has(tag)) ?? 'other';
}

function normalizeName(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function describeClip(clip) {
  const names = clip.artist
    .split(/\s+(?:feat\.?|ft\.?|x|×|&|и)\s+|\s*,\s*/iu)
    .map(normalizeName)
    .filter(Boolean);
  const artists = new Set(names);
  const song =
    artists.size && clip.title
      ? `${[...artists].sort().join(',')}|${normalizeName(clip.title)}`
      : clip.id;
  return { clip, song, artists, tags: new Set(clip.tags), genre: clipGenre(clip) };
}

function sharesArtist(clip, other) {
  return [...clip.artists].some((artist) => other.artists.has(artist));
}

function similarity(clip, rated, tagWeights) {
  let sharedTags = 0;
  for (const tag of clip.tags) {
    if (rated.tags.has(tag)) sharedTags += tagWeights.get(tag);
  }
  return (
    (sharesArtist(clip, rated) ? 1.35 : 0) +
    (0.95 * sharedTags) / Math.max(1, clip.tags.size, rated.tags.size)
  );
}

function preference(clip, ratedClips, watchedClips, tagWeights) {
  let favorite = 0;
  let liked = 0;
  let disliked = 0;
  for (const rated of ratedClips) {
    const match = similarity(clip, rated, tagWeights);
    if (rated.rating === 1) {
      favorite = Math.max(favorite, match);
      liked += match;
    } else {
      disliked += match;
    }
  }
  // Дополнительные оценки уточняют вкус, не перекрывая одну явную реакцию на артиста.
  const score =
    favorite * 1.45 + Math.log1p(liked - favorite) * 0.4 - Math.log1p(disliked * 3) * 1.55;
  const viewing = watchedClips.reduce(
    (sum, track) => sum + similarity(clip, track, tagWeights) * track.signal,
    0,
  );
  return Math.max(-4, Math.min(4, score + 0.6 * Math.tanh(viewing)));
}

export function pickClip(
  catalog,
  ratings,
  { recent = [], unavailable = new Set(), playback = {}, afterDislike, random = Math.random } = {},
) {
  const tracks = catalog.map(describeClip);
  const byId = new Map(tracks.map((track) => [track.clip.id, track]));
  const ratedClips = tracks.flatMap((track) => {
    const rating = ratings[track.clip.id];
    return rating === 1 || rating === -1 ? [{ ...track, rating }] : [];
  });
  const hiddenSongs = new Set(
    ratedClips.filter(({ rating }) => rating === -1).map(({ song }) => song),
  );
  const ratedSongs = new Set(ratedClips.map(({ song }) => song));
  const watchedSongs = new Map();
  for (const track of tracks) {
    const signal = playback[track.clip.id];
    if (!ratedSongs.has(track.song) && (signal === 1 || signal === -1)) {
      watchedSongs.set(track.song, { ...track, signal });
    }
  }
  const watchedClips = [...watchedSongs.values()];
  const available = new Map();
  for (const track of tracks) {
    if (
      !hiddenSongs.has(track.song) &&
      !unavailable.has(track.clip.id) &&
      !available.has(track.song)
    ) {
      available.set(track.song, track);
    }
  }
  if (!available.size) return null;

  const cooldown = Math.min(available.size - 1, Math.max(5, Math.floor(available.size * 0.75)));
  const recentSongs = recent
    .map((id) => byId.get(id)?.song)
    .reverse()
    .filter((song) => available.has(song));
  const excluded = new Set([...new Set(recentSongs)].slice(0, cooldown));
  let candidates = [...available.values()].filter(({ song }) => !excluded.has(song));
  const rejected = byId.get(afterDislike);
  if (rejected) {
    const otherArtists = candidates.filter((track) => !sharesArtist(track, rejected));
    const otherGenres = otherArtists.filter(({ genre }) => genre !== rejected.genre);
    const rejectedGenres = new Set(
      recent
        .slice(-5)
        .filter((id) => ratings[id] === -1)
        .map((id) => byId.get(id)?.genre),
    );
    const newGenres = otherGenres.filter(({ genre }) => !rejectedGenres.has(genre));
    if (newGenres.length) candidates = newGenres;
    else if (otherGenres.length) candidates = otherGenres;
    else if (otherArtists.length) candidates = otherArtists;
  }

  const tagCounts = new Map();
  for (const { tags } of tracks) {
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const tagWeights = new Map(
    [...tagCounts].map(([tag, count]) => [
      tag,
      Math.max(0.2, Math.min(1, Math.log((tracks.length + 1) / (count + 1)))),
    ]),
  );
  const genreCounts = new Map();
  for (const { genre } of candidates) {
    genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
  }
  const recentGenres = new Map();
  for (const id of recent.slice(-5)) {
    const track = byId.get(id);
    if (track && !unavailable.has(id)) {
      recentGenres.set(track.genre, (recentGenres.get(track.genre) ?? 0) + 1);
    }
  }

  let rankedTotal = 0;
  let familiarTotal = 0;
  let discoveryTotal = 0;
  const weights = candidates.map((track) => {
    const affinity = preference(track, ratedClips, watchedClips, tagWeights);
    const ranked = Math.exp(affinity);
    const familiar = affinity >= 0.7 ? ranked : 0;
    const repeated = Math.max(0, (recentGenres.get(track.genre) ?? 0) - 1);
    // Доля жанра в поиске нового зависит от предпочтений, а не от длины его списка.
    const discovery =
      Math.exp(Math.min(0.7, affinity)) /
      (Math.max(4, genreCounts.get(track.genre)) * (1 + repeated));
    rankedTotal += ranked;
    familiarTotal += familiar;
    discoveryTotal += discovery;
    return { ranked, familiar, discovery };
  });

  // Близкие совпадения получают отдельную долю выдачи даже при большом общем каталоге.
  const familiarShare = familiarTotal ? 0.5 : 0;
  const discoveryShare = familiarTotal ? 0.25 : 0.65;
  const rankedShare = 1 - familiarShare - discoveryShare;
  let remaining = random();
  for (const [index, { ranked, familiar, discovery }] of weights.entries()) {
    remaining -=
      (rankedShare * ranked) / rankedTotal + (discoveryShare * discovery) / discoveryTotal;
    if (familiarShare) remaining -= (familiarShare * familiar) / familiarTotal;
    if (remaining < 0) return candidates[index].clip;
  }
  return candidates.at(-1).clip;
}
