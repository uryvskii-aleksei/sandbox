<?php

declare(strict_types=1);

const RUTUBE_CHANNELS = [
    23894382 => ['rock', 'pop'],       // Союз Мьюзик
    23586656 => ['pop'],               // Gutseriev Media
    23342656 => ['pop', 'indie'],      // Velvet Music
    24728360 => ['hip-hop', 'pop'],    // BlackStar TV
    709585 => ['pop', 'indie'],        // Zion Music
    24904043 => ['hip-hop'],           // Divine Music Russia
    30711836 => ['hip-hop'],           // FASTASATU MUSIC LABEL
    31193200 => ['pop', 'hip-hop'],    // VK Records
    56355807 => ['pop', 'folk'],       // integration.media
    83425727 => ['indie', 'pop'],      // OUR ANGELS
    56728450 => ['indie', 'pop'],      // Chemodanov Music Label
];

function rutubeGenres(array $item, int $channel): array
{
    $description = (string) ($item['description'] ?? '');
    preg_match_all('/#[\p{L}\p{N}_-]+/u', $description, $matches);
    $markers = implode(' ', $matches[0]);
    $styles = [
        'metal' => 'metal|метал[л]?|металкор|metalcore|heavymetal|hardrock',
        'rock' => 'rock|рок|русский_?рок|russian_?rock|poprock|punkrock|альтернативныйрок',
        'hip-hop' => 'hip[_-]?hop|хип[_-]?хоп|rap|рэп|trap|трэп|русский_?рэп',
        'electronic' => 'electronic|электроника|techno|техно|edm|house|phonk|фонк|synthwave',
        'dance' => 'dance|dancepop|дэнс|танцевальнаямузыка|house|edm',
        'folk' => 'folk|фолк|народнаямузыка|этномузыка|folkmusic',
        'indie' => 'indie|инди|indiepop|indierock',
        'chanson' => 'chanson|шансон|русский_?шансон',
        'jazz' => 'jazz|джаз',
        'acoustic' => 'acoustic|акустика|unplugged',
        'pop' => 'pop|поп|попмузыка|поп[_-]музыка|popmusic|русский_?поп',
    ];
    $genres = [];
    foreach ($styles as $genre => $pattern) {
        if (preg_match('/#(?:' . $pattern . ')(?=\s|$)/iu', $markers)) {
            $genres[] = $genre;
        }
    }
    return $genres ?: RUTUBE_CHANNELS[$channel];
}

function rutubeClip(array $item, int $channel): ?array
{
    $id = $item['id'] ?? '';
    $name = $item['title'] ?? '';
    $duration = $item['duration'] ?? 0;
    if (
        !is_string($id) || !preg_match('/^[a-f0-9]{32}$/D', $id) ||
        !is_string($name) || !preg_match('/клип|(?:official|music|lyric|mood)\s+video/iu', $name) ||
        preg_match('/тизер|сниппет|shorts|бэкстейдж|реакция|интервью|сборник|подборка|официальный трейлер/iu', $name) ||
        !is_int($duration) || $duration < 90 || $duration > 540 ||
        ($item['author']['id'] ?? null) !== $channel ||
        ($item['embed_url'] ?? null) !== 'https://rutube.ru/play/embed/' . $id ||
        ($item['is_adult'] ?? true) || ($item['is_hidden'] ?? true) || ($item['is_deleted'] ?? false) ||
        ($item['is_paid'] ?? false) || ($item['is_audio'] ?? false) || ($item['is_livestream'] ?? false)
    ) {
        return null;
    }

    $credit = (string) $item['author']['name'];
    $name = trim(preg_replace('/\s+/u', ' ', $name));
    $parts = preg_split('/\s+[—–-]\s+/u', $name, 2);
    [$artist, $title] = count($parts) === 2 ? $parts : [$credit, $name];
    $title = trim(preg_replace('/\s*[([][^)\]]*(?:клип|(?:official|music|lyric|mood)\s+video)[^)\]]*[)\]].*$/iu', '', $title));
    $poster = $item['thumbnail_url'] ?? '';
    return [
        'id' => 'rutube-' . $id,
        'provider' => 'rutube',
        'artist' => $artist,
        'title' => $title ?: $name,
        'tags' => rutubeGenres($item, $channel),
        'credit' => $credit,
        'source' => 'https://rutube.ru/video/' . $id . '/',
        'embed' => $item['embed_url'],
        'poster' => is_string($poster) && str_starts_with($poster, 'https://pic.rtbcdn.ru/') ? $poster : null,
    ];
}

function fetchRutubeClips(int $pages = 2, int $firstPage = 1): array
{
    if (!function_exists('curl_multi_init')) {
        return [];
    }

    $multi = curl_multi_init();
    $requests = [];
    foreach (array_keys(RUTUBE_CHANNELS) as $channel) {
        for ($page = $firstPage; $page < $firstPage + $pages; $page++) {
            $url = 'https://rutube.ru/api/video/person/' . $channel . '/?page=' . $page;
            $request = curl_init($url);
            curl_setopt_array($request, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT_MS => 1600,
                CURLOPT_TIMEOUT_MS => 3500,
                CURLOPT_USERAGENT => 'Wave music video catalog/1.0',
            ]);
            curl_multi_add_handle($multi, $request);
            $requests[] = [$channel, $request];
        }
    }
    do {
        $status = curl_multi_exec($multi, $running);
        if ($running && curl_multi_select($multi, 0.2) === -1) {
            usleep(1000);
        }
    } while ($running && $status === CURLM_OK);

    $clips = [];
    foreach ($requests as [$channel, $request]) {
        if (curl_getinfo($request, CURLINFO_RESPONSE_CODE) === 200) {
            $page = json_decode(curl_multi_getcontent($request), true);
            foreach ($page['results'] ?? [] as $item) {
                $clip = is_array($item) ? rutubeClip($item, $channel) : null;
                if ($clip !== null) {
                    $clips[$clip['id']] = $clip;
                }
            }
        }
        curl_multi_remove_handle($multi, $request);
    }
    curl_multi_close($multi);
    return array_values($clips);
}

function cachedClips(PDO $db, bool $refresh = false): array
{
    $stored = $db->query('SELECT clips, next_refresh FROM catalog_cache WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
    $previous = json_decode($stored['clips'] ?? '[]', true, 512, JSON_THROW_ON_ERROR);
    $now = time();
    if (!$refresh || ($stored['next_refresh'] ?? 0) > $now || !function_exists('curl_multi_init')) {
        return $previous;
    }

    // Резервируем обновление одним запросом и загружаем ленты вне транзакции.
    $claim = $db->prepare(
        "INSERT INTO catalog_cache (id, clips, next_refresh) VALUES (1, '[]', ?)
         ON CONFLICT (id) DO UPDATE SET next_refresh = excluded.next_refresh
         WHERE catalog_cache.next_refresh <= ?"
    );
    $claim->execute([$now + 900, $now]);
    if ($claim->rowCount() === 0) {
        return $previous;
    }

    $fresh = fetchRutubeClips();
    if (!$fresh) {
        return $previous;
    }
    $merged = array_column($fresh, null, 'id') + array_column($previous, null, 'id');
    $clips = array_slice(array_values($merged), 0, 300);
    $db->prepare('UPDATE catalog_cache SET clips = ?, next_refresh = ? WHERE id = 1')
        ->execute([json_encode($clips, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), $now + 3600]);
    return $clips;
}
