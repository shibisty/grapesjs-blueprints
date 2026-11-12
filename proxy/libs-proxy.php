<?php
/**
 * CORS proxy for the library search of grapesjs-scripts (only needed when the CDN APIs do not
 * answer the browser directly). GET libs-proxy.php?url=<encoded https URL>.
 *
 * - Only whitelisted hosts and GET.
 * - Disk cache (default 6 h); a stale copy is served when the upstream fails.
 * - Env: LIBS_PROXY_ORIGINS (comma-separated allowed origins, default *), LIBS_PROXY_TTL (s),
 *   LIBS_PROXY_CACHE (cache dir, default system temp).
 * PHP 7.2+, needs curl or allow_url_fopen.
 */
$allowedHosts = ['registry.npmjs.org', 'data.jsdelivr.com', 'api.cdnjs.com'];
$ttl = (int) (getenv('LIBS_PROXY_TTL') ?: 21600);
$cacheDir = getenv('LIBS_PROXY_CACHE') ?: sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'gjs-libs-proxy';
$origins = array_filter(array_map('trim', explode(',', getenv('LIBS_PROXY_ORIGINS') ?: '*')));

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array('*', $origins, true)) header('Access-Control-Allow-Origin: *');
elseif ($origin && in_array($origin, $origins, true)) { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
elseif ($origin) { http_response_code(403); exit('origin not allowed'); }
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Accept');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { http_response_code(405); exit('GET only'); }

$url = $_GET['url'] ?? '';
$parts = parse_url($url);
if (!$parts || ($parts['scheme'] ?? '') !== 'https' || !in_array($parts['host'] ?? '', $allowedHosts, true) || isset($parts['user']) || isset($parts['port'])) {
  http_response_code(400);
  exit('url not allowed');
}

if (!is_dir($cacheDir)) @mkdir($cacheDir, 0775, true);
$file = $cacheDir . DIRECTORY_SEPARATOR . sha1($url) . '.json';
$fresh = is_file($file) && (time() - filemtime($file) < $ttl);
header('Content-Type: application/json; charset=utf-8');
if ($fresh) { header('X-Cache: HIT'); readfile($file); exit; }

$body = false; $status = 0;
if (function_exists('curl_init')) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => ['Accept: application/json'], CURLOPT_USERAGENT => 'grapesjs-scripts-proxy']);
  $body = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
} else {
  $ctx = stream_context_create(['http' => ['timeout' => 15, 'header' => "Accept: application/json\r\nUser-Agent: grapesjs-scripts-proxy\r\n", 'ignore_errors' => true]]);
  $body = @file_get_contents($url, false, $ctx);
  if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) $status = (int) $m[1];
}

if ($body !== false && $status >= 200 && $status < 300) {
  @file_put_contents($file, $body, LOCK_EX);
  header('X-Cache: MISS');
  echo $body;
} elseif (is_file($file)) {
  header('X-Cache: STALE');
  readfile($file);
} else {
  http_response_code($status ?: 502);
  echo json_encode(['error' => 'upstream failed', 'status' => $status]);
}
