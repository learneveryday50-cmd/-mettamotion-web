<?php
/**
 * assign-images.php
 * Run on the server via SSH: php /tmp/assign-images.php
 * Calls WordPress REST API via localhost to bypass firewall.
 */

$WP_HOST    = 'mettamotion.com';
$WP_USER    = getenv('WP_USER');
$WP_PASS    = getenv('WP_APP_PASS');
$PEXELS_KEY = getenv('PEXELS_KEY');
$SEARCH     = getenv('SEARCH_QUERY') ?: 'automation workflow technology n8n';

$WP_AUTH    = base64_encode("$WP_USER:$WP_PASS");

// ── HTTP helpers ──────────────────────────────────────────────────

function wp_request(string $method, string $path, array $headers = [], $body = null): array {
    global $WP_HOST, $WP_AUTH;

    // Call via localhost to bypass external firewall
    $url = "http://127.0.0.1{$path}";
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => array_merge([
            "Host: {$WP_HOST}",
            "Authorization: Basic {$WP_AUTH}",
        ], $headers),
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $resp   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    if ($err) throw new RuntimeException("curl error: $err");
    return ['status' => $status, 'body' => $resp];
}

function pexels_get(string $url): array {
    global $PEXELS_KEY;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => ["Authorization: {$PEXELS_KEY}"],
    ]);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($err) throw new RuntimeException("Pexels curl error: $err");
    return json_decode($resp, true);
}

function download_image(string $url): string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 30,
    ]);
    $data = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($err) throw new RuntimeException("Image download error: $err");
    return $data;
}

// ── Fetch WP posts without featured image ─────────────────────────

echo "=== Mettamotion: Auto Featured Image Assign ===\n\n";
echo "Fetching WordPress posts...\n";

$posts   = [];
$page    = 1;
while (true) {
    $res  = wp_request('GET', "/wp-json/wp/v2/posts?_embed&per_page=100&page={$page}&orderby=date&order=desc");
    $batch = json_decode($res['body'], true);
    if (!is_array($batch) || empty($batch)) break;
    $posts = array_merge($posts, $batch);
    if (count($batch) < 100) break;
    $page++;
}

$missing = array_filter($posts, function($p) {
    return empty($p['_embedded']['wp:featuredmedia'][0]['source_url']);
});
$missing = array_values($missing);

echo "Total posts:   " . count($posts)   . "\n";
echo "Missing image: " . count($missing) . "\n\n";

if (empty($missing)) {
    echo "All posts already have featured images.\n";
    exit(0);
}

// ── Fetch Pexels photos ───────────────────────────────────────────

$needed = count($missing);
echo "Fetching {$needed} photos from Pexels (query: \"{$SEARCH}\")...\n";

$photos = [];
$ppage  = 1;
while (count($photos) < $needed) {
    $data = pexels_get("https://api.pexels.com/v1/search?query=" . urlencode($SEARCH) . "&per_page=80&page={$ppage}&orientation=landscape");
    if (empty($data['photos'])) break;
    $photos = array_merge($photos, $data['photos']);
    if (empty($data['next_page'])) break;
    $ppage++;
}

echo "Got " . count($photos) . " photos.\n\n";

if (empty($photos)) {
    echo "No photos from Pexels. Check your API key.\n";
    exit(1);
}

// ── Assign images ─────────────────────────────────────────────────

$total   = count($missing);
$success = 0;
$failed  = 0;

foreach ($missing as $i => $post) {
    $photo   = $photos[$i % count($photos)];
    $imgUrl  = $photo['src']['large2x'] ?? $photo['src']['large'] ?? $photo['src']['original'];
    $title   = strip_tags($post['title']['rendered']);
    $postId  = $post['id'];
    $photoId = $photo['id'];
    $n       = $i + 1;

    echo "[{$n}/{$total}] \"{$title}\"... ";

    try {
        // Download image
        $imgData  = download_image($imgUrl);
        $filename = "post-{$postId}-pexels-{$photoId}.jpg";

        // Upload to WP media library
        $uploadRes = wp_request('POST', '/wp-json/wp/v2/media', [
            "Content-Disposition: attachment; filename=\"{$filename}\"",
            'Content-Type: image/jpeg',
        ], $imgData);

        $media = json_decode($uploadRes['body'], true);
        if (empty($media['id'])) {
            throw new RuntimeException("Upload failed ({$uploadRes['status']}): " . substr($uploadRes['body'], 0, 200));
        }
        $mediaId = $media['id'];

        // Set as featured image
        $updateRes = wp_request('POST', "/wp-json/wp/v2/posts/{$postId}", [
            'Content-Type: application/json',
        ], json_encode(['featured_media' => $mediaId]));

        if ($updateRes['status'] >= 400) {
            throw new RuntimeException("Set featured failed ({$updateRes['status']})");
        }

        echo "✓  (Photo by {$photo['photographer']})\n";
        $success++;
    } catch (Exception $e) {
        echo "✗  {$e->getMessage()}\n";
        $failed++;
    }

    usleep(300000); // 0.3s delay
}

echo "\n=== Done: {$success} set, {$failed} failed ===\n";
