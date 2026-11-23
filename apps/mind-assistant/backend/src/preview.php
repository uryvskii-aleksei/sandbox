<?php
declare(strict_types=1);
namespace MindAssistant;

/** Фиксирует публичный IP для cURL, чтобы URL-превью не открывало внутреннюю сеть. */
function previewTarget(string $url): array
{
    $parts = parse_url($url);
    if (!$parts || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) ||
        isset($parts['user']) || isset($parts['pass']) || !isset($parts['host'])) fail(422, 'Нужна публичная HTTP(S)-ссылка.');
    $host = strtolower($parts['host']);
    $port = $parts['port'] ?? ($parts['scheme'] === 'https' ? 443 : 80);
    if (!in_array($port, [80, 443], true) || !preg_match('/^[a-z0-9.-]+$/', $host)) fail(422, 'Недопустимый адрес.');
    $addresses = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : gethostbynamel($host);
    if (!$addresses) fail(422, 'Не удалось найти сайт.');
    foreach ($addresses as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) fail(422, 'Внутренние адреса недоступны для превью.');
    }
    return [$host, $port, $addresses[0]];
}

function absoluteUrl(string $base, string $reference): string
{
    $reference = trim($reference);
    if (preg_match('~^https?://~i', $reference)) return $reference;
    $parts = parse_url($base);
    if (str_starts_with($reference, '//')) return $parts['scheme'] . ':' . $reference;
    $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    return $origin . (str_starts_with($reference, '/') ? $reference : dirname($parts['path'] ?? '/') . '/' . $reference);
}

function preview(string $url): array
{
    for ($redirects = 0; $redirects < 4; $redirects++) {
        [$host, $port, $ip] = previewTarget($url);
        $body = ''; $location = '';
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_RESOLVE => ["$host:$port:$ip"],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT => 'MindAssistant/1.0 URL Preview',
            CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
                if (strlen($body) + strlen($chunk) > 1048576) return 0;
                $body .= $chunk; return strlen($chunk);
            },
            CURLOPT_HEADERFUNCTION => static function ($handle, string $header) use (&$location): int {
                if (stripos($header, 'Location:') === 0) $location = trim(substr($header, 9));
                return strlen($header);
            },
        ]);
        $result = curl_exec($curl); $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $contentType = curl_getinfo($curl, CURLINFO_CONTENT_TYPE) ?: '';
        curl_close($curl);
        if ($status >= 300 && $status < 400 && $location !== '') { $url = absoluteUrl($url, $location); continue; }
        if ($result === false || $status !== 200 || stripos($contentType, 'text/html') === false) fail(422, 'Сайт не предоставил HTML-страницу для превью.');
        $document = new \DOMDocument();
        $previous = libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="utf-8"?>' . $body, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors(); libxml_use_internal_errors($previous);
        $xpath = new \DOMXPath($document);
        $meta = static function (string $expression) use ($xpath): string {
            $value = trim((string) $xpath->evaluate($expression));
            preg_match('/^.{0,500}/us', $value, $match);
            return $match[0] ?? '';
        };
        $image = $meta('string(//meta[@property="og:image"]/@content)');
        if ($image !== '' && !preg_match('~^https?://~i', $image)) $image = absoluteUrl($url, $image);
        return ['title' => $meta('string(//meta[@property="og:title"]/@content)') ?: $meta('string(//title)'),
            'description' => $meta('string(//meta[@name="description"]/@content)'),
            'image' => preg_match('~^https?://~i', $image) ? $image : '', 'link' => $url];
    }
    fail(422, 'Слишком много перенаправлений.');
}
