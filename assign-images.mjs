/**
 * assign-images.mjs
 * Fetches all WordPress posts without a featured image,
 * pulls unique photos from Pexels, uploads each to WP media library,
 * and sets it as that post's featured image.
 *
 * Usage:  node assign-images.mjs
 */

import https from 'https';
import http  from 'http';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

// ── Load .env ────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath   = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim();
  }
}

const WP_URL      = process.env.WP_URL;
const WP_USER     = process.env.WP_USER;
const WP_APP_PASS = process.env.WP_APP_PASS;
const PEXELS_KEY  = process.env.PEXELS_KEY;
const SEARCH_QUERY = process.env.SEARCH_QUERY || 'automation workflow technology';

const WP_AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString('base64');

// ── HTTP helpers ─────────────────────────────────────────────────
function rawRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getJson(url, headers = {}) {
  const res = await rawRequest(url, { headers });
  if (res.status >= 400) throw new Error(`GET ${url} → ${res.status}: ${res.body.toString().slice(0, 200)}`);
  return JSON.parse(res.body.toString());
}

async function downloadBuffer(url) {
  for (let i = 0; i < 5; i++) {
    const lib = url.startsWith('https') ? https : http;
    const res = await new Promise((resolve, reject) => lib.get(url, resolve).on('error', reject));
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      url = res.headers.location;
      continue;
    }
    const chunks = [];
    await new Promise((resolve, reject) => { res.on('data', c => chunks.push(c)); res.on('end', resolve); res.on('error', reject); });
    return Buffer.concat(chunks);
  }
  throw new Error('Too many redirects');
}

// ── Pexels ───────────────────────────────────────────────────────
async function fetchPexelsPhotos(needed) {
  const photos = [];
  let page = 1;
  while (photos.length < needed) {
    const data = await getJson(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(SEARCH_QUERY)}&per_page=80&page=${page}&orientation=landscape`,
      { Authorization: PEXELS_KEY }
    );
    if (!data.photos?.length) break;
    photos.push(...data.photos);
    if (!data.next_page) break;
    page++;
  }
  return photos;
}

// ── WordPress ────────────────────────────────────────────────────
async function fetchAllWPPosts() {
  const posts = [];
  let page = 1;
  while (true) {
    const batch = await getJson(
      `${WP_URL}/wp-json/wp/v2/posts?_embed&per_page=100&page=${page}&orderby=date&order=desc`,
      { Authorization: `Basic ${WP_AUTH}` }
    );
    if (!Array.isArray(batch) || !batch.length) break;
    posts.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return posts;
}

async function uploadImageToWP(buffer, filename) {
  const res = await rawRequest(
    `${WP_URL}/wp-json/wp/v2/media`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${WP_AUTH}`,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'image/jpeg',
        'Content-Length': buffer.length,
      },
    },
    buffer
  );
  const data = JSON.parse(res.body.toString());
  if (!data.id) throw new Error(`Upload failed (${res.status}): ${res.body.toString().slice(0, 300)}`);
  return data.id;
}

async function setFeaturedMedia(postId, mediaId) {
  const body = Buffer.from(JSON.stringify({ featured_media: mediaId }));
  const res = await rawRequest(
    `${WP_URL}/wp-json/wp/v2/posts/${postId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${WP_AUTH}`,
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    },
    body
  );
  if (res.status >= 400) throw new Error(`Set featured media failed (${res.status}): ${res.body.toString().slice(0, 200)}`);
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log('=== Mettamotion: Auto Featured Image Assign ===\n');

  console.log('Fetching all WordPress posts...');
  const allPosts = await fetchAllWPPosts();
  const missing  = allPosts.filter(p => !p._embedded?.['wp:featuredmedia']?.[0]?.source_url);

  console.log(`Total posts : ${allPosts.length}`);
  console.log(`Missing image: ${missing.length}\n`);

  if (!missing.length) {
    console.log('All posts already have featured images. Nothing to do.');
    return;
  }

  console.log(`Fetching ${missing.length} photos from Pexels (query: "${SEARCH_QUERY}")...`);
  const photos = await fetchPexelsPhotos(missing.length);
  console.log(`Got ${photos.length} photos.\n`);

  if (!photos.length) {
    console.error('No photos returned from Pexels. Check your API key or search query.');
    return;
  }

  let success = 0;
  let failed  = 0;

  for (let i = 0; i < missing.length; i++) {
    const post  = missing[i];
    const photo = photos[i % photos.length];
    const title = post.title.rendered.replace(/<[^>]+>/g, '').trim();
    const imgUrl = photo.src.large2x || photo.src.large || photo.src.original;

    process.stdout.write(`[${i + 1}/${missing.length}] "${title.slice(0, 60)}"... `);

    try {
      const buffer  = await downloadBuffer(imgUrl);
      const filename = `post-${post.id}-pexels-${photo.id}.jpg`;
      const mediaId  = await uploadImageToWP(buffer, filename);
      await setFeaturedMedia(post.id, mediaId);
      console.log(`✓  (Photo by ${photo.photographer})`);
      success++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== Done: ${success} set, ${failed} failed ===`);
}

main().catch(err => { console.error(err); process.exit(1); });
