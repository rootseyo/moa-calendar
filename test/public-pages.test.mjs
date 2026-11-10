import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servePublicPage } from '../public-pages.mjs';

function request(path, method = 'GET') {
 const res = { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key] = value; }, end(content) { this.body = content; } };
 res.handled = servePublicPage({ method }, res, path, 'https://calendar.example');
 return res;
}

test('analytics script is served externally without executable inline scripts', () => {
 const html = request('/').body;
 assert.match(html, /<script defer src="\/analytics\.js\?v=[^"]+"><\/script>/);
 assert.doesNotMatch(html, /<script\s*>/i);
 const analytics = request('/analytics.js');
 assert.equal(analytics.statusCode, 200);
 assert.match(analytics.headers['Content-Type'], /text\/javascript/);
 assert.match(analytics.body.toString(), /analytics\/collect/);
});

test('home has indexable content and environment-specific canonical metadata', () => {
 const res = request('/');
 assert.equal(res.statusCode, 200);
 assert.match(res.headers['X-Robots-Tag'], /^index, follow/);
 assert.match(res.body, /rel="canonical" href="https:\/\/calendar.example\/"/);
 assert.match(res.body, /property="og:image" content="https:\/\/calendar.example\/og-image.png"/);
 assert.doesNotMatch(res.body, /서비스 불러오는 중/);
 assert.match(res.body, /공유 캘린더/);
 assert.match(res.body, /내 캘린더/);
 assert.doesNotMatch(res.body, /__(SITE_URL|ROBOTS)__/);
 const jsonld = JSON.parse(res.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
 assert.equal(jsonld['@graph'][0].url, 'https://calendar.example/');
});

test('calendar and invitation pages are excluded from indexing', () => {
 for (const path of ['/family', '/invite/secret-token']) {
  const res = request(path);
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.match(res.body, /name="robots" content="noindex, nofollow"/);
 }
 const sitemap = request('/sitemap.xml');
 assert.match(sitemap.body, /<loc>https:\/\/calendar.example\/<\/loc>/);
 assert.equal((sitemap.body.match(/<url>/g) || []).length, 3);
 assert.match(request('/robots.txt').body, /Allow: \/\$\n/);
 assert.match(request('/robots.txt').body, /Disallow: \/\n/);
});

test('manifest names and every home screen icon are served with correct formats', () => {
 const res = request('/manifest.webmanifest');
 assert.match(res.headers['Content-Type'], /application\/manifest\+json/);
 const manifest = JSON.parse(res.body.toString());
 assert.equal(manifest.name, '모아 캘린더');
 assert.equal(manifest.short_name, '모아 캘린더');
 assert.equal(manifest.start_url, '/');
 assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
 for (const icon of manifest.icons) {
  const image = request(icon.src);
  assert.equal(image.headers['Content-Type'], 'image/png');
  assert.equal(image.body.subarray(1, 4).toString(), 'PNG');
  const [width, height] = icon.sizes.split('x').map(Number);
  assert.equal(image.body.readUInt32BE(16), width);
  assert.equal(image.body.readUInt32BE(20), height);
 }
 assert.equal(request('/favicon.ico').body.readUInt16LE(2), 1);
 assert.equal(request('/favicon.svg').headers['Content-Type'], 'image/svg+xml');
 assert.equal(request('/event-utils.js').headers['Content-Type'], 'text/javascript; charset=utf-8');
 assert.match(request('/event-utils.js').body.toString(), /export function weeklyEventRanges/);
 assert.equal(request('/og-image.png').body.readUInt32BE(16), 1200);
});

test('HEAD is bodyless and nonexistent resources return 404 instead of app HTML', () => {
 const res = request('/icons/icon-512.png', 'HEAD');
 assert.equal(res.headers['Content-Type'], 'image/png');
 assert.equal(res.body, undefined);
 assert.equal(request('/missing.png').statusCode, 404);
 assert.equal(request('/icons/missing.png').statusCode, 404);
 assert.equal(request('/api/me').handled, false);
 assert.equal(request('/auth/kakao').handled, false);
});

test('app and html contain calendar delete controls and english translations', () => {
 const htmlRes = request('/');
 assert.match(htmlRes.body, /id="delete-calendar-btn"/);
 const enHtmlRes = request('/en/');
 assert.match(enHtmlRes.body, /<button[^>]*id="delete-calendar-btn"[^>]*>Delete calendar<\/button>/);
 const enAppRes = request('/app.en.js');
 assert.match(enAppRes.body, /Calendar deleted\./);
});

test('landing page features include weather check and d-day in korean and english', () => {
 const appRes = request('/app.js');
 assert.match(appRes.body.toString(), /🌤 \$\{tr\('날씨 확인'\)\}/);
 assert.match(appRes.body.toString(), /🚩 \$\{tr\('D-Day 디데이'\)\}/);
 assert.match(appRes.body.toString(), /paper-dday/);
 const enAppRes = request('/app.en.js');
 assert.match(enAppRes.body, /Weather forecast/);
 assert.match(enAppRes.body, /D-Day countdown/);
 assert.match(enAppRes.body, /Trip to Jeju/);
 assert.match(enAppRes.body, /October together ⛅ 19°/);
});

test('korean word-break and natural text wrapping are configured in style.css', () => {
 const cssRes = request('/style.css');
 const css = cssRes.body.toString();
 assert.match(css, /body\{[^}]*word-break:keep-all[^}]*overflow-wrap:break-word/);
 assert.match(css, /text-wrap:balance/);
 assert.match(css, /text-wrap:pretty/);
 assert.match(css, /#date-note-status\{[^}]*word-break:keep-all/);
 assert.match(css, /\.date-note-description\{[^}]*word-break:keep-all/);
});

test('home HTML contains instant calendar workspace skeleton instead of loading box in #app', () => {
 const res = request('/');
 assert.match(res.body, /<div id="app"><div class="workspace" id="workspace-root">/);
 assert.match(res.body, /<div id="calendar">/);
 const appJs = request('/app.js').body.toString();
 assert.match(appJs, /moa_cached_me/);
 assert.doesNotMatch(appJs, /renderLoading\('서비스 불러오는 중\.\.\.','캘린더와 일정을 준비하고 있어요\.'\)/);
 assert.doesNotMatch(appJs, /서비스 불러오는 중/);
});


test('settings sections and calendar details support direct access without being indexed', () => {
 for (const path of ['/settings', '/settings/', '/settings/calendars', '/settings/calendars/family', '/settings/icloud', '/settings/google', '/settings/migrate', '/settings/account', '/settings/preferences', '/settings/sessions']) {
  const res = request(path);
  assert.equal(res.statusCode, 200, path);
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow', path);
  assert.match(res.body, /id="settings-page"[^>]*hidden/);
 }
 assert.equal(request('/settings/unknown').statusCode, 404);
 assert.equal(request('/settings/icloud', 'HEAD').body, undefined);
});
