import { translateSource } from './public/translations.js';
import { readFileSync } from 'node:fs';

const assets = new Map([
 ['/locale.js', 'text/javascript; charset=utf-8'],
 ['/analytics.js', 'text/javascript; charset=utf-8'],
 ['/translations.js', 'text/javascript; charset=utf-8'],
 ['/app.js', 'text/javascript; charset=utf-8'],
 ['/event-utils.js', 'text/javascript; charset=utf-8'],
 ['/lunar.js', 'text/javascript; charset=utf-8'],
 ['/weather.js', 'text/javascript; charset=utf-8'],
 ['/vendor/korean-lunar-calendar.mjs', 'text/javascript; charset=utf-8'],
 ['/vendor/korean-lunar-calendar.LICENSE.txt', 'text/plain; charset=utf-8'],
 ['/holidays.js', 'text/javascript; charset=utf-8'],
 ['/legal.css', 'text/css; charset=utf-8'],
 ['/style.css', 'text/css; charset=utf-8'],
 ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
 ['/sw.js', 'text/javascript; charset=utf-8'],
 ['/privacy.html', 'text/html; charset=utf-8'],
 ['/terms.html', 'text/html; charset=utf-8'],
 ['/favicon.svg', 'image/svg+xml'],
 ['/favicon.ico', 'image/x-icon'],
 ['/og-image.png', 'image/png'],
 ...['favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].map(name => [`/icons/${name}`, 'image/png']),
]);
const escapeHTML = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const publicFile = path => readFileSync(new URL(`./public${path}`, import.meta.url));

// Public resources do not depend on a login session or database connection.
export function servePublicPage(req, res, pathname, appOrigin) {
 if (!['GET', 'HEAD'].includes(req.method)) return false;
 const origin = new URL(appOrigin).origin;
 const send = (type, content, cache = 'no-store', status = 200) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache);
  res.statusCode = status;
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
 };
 if(pathname==='/app.en.js')return send('text/javascript; charset=utf-8',translateSource(publicFile('/app.js').toString('utf8')),'public, max-age=3600');
 if(pathname==='/en'||pathname==='/ko'){res.setHeader('Location',pathname+'/');return send('text/plain; charset=utf-8','Redirecting','no-store',301);}
 if (pathname === '/privacy' || pathname === '/privacy/') { res.setHeader('Location', '/privacy.html?v=20261013-oauth-v2'); return send('text/plain; charset=utf-8', 'Redirecting', 'no-store', 301); }
 if (pathname === '/terms' || pathname === '/terms/') { res.setHeader('Location', '/terms.html?v=20261013-oauth-v2'); return send('text/plain; charset=utf-8', 'Redirecting', 'no-store', 301); }
 if (assets.has(pathname)) return send(assets.get(pathname), publicFile(pathname), ['/privacy.html','/terms.html','/sw.js'].includes(pathname)?'no-store':'public, max-age=3600');
 if (pathname === '/robots.txt') {
  return send('text/plain; charset=utf-8', `User-agent: *\nAllow: /$\nAllow: /en/$\nAllow: /ko/$\nAllow: /privacy.html$\nAllow: /terms.html$\nAllow: /locale.js\nAllow: /translations.js\nAllow: /app.en.js\nAllow: /app.js\nAllow: /sw.js\nAllow: /event-utils.js\nAllow: /holidays.js\nAllow: /lunar.js\nAllow: /weather.js\nAllow: /style.css\nAllow: /icons/\nAllow: /favicon\nAllow: /og-image.png\nAllow: /manifest.webmanifest\nDisallow: /\n\nSitemap: ${origin}/sitemap.xml\n`, 'public, max-age=3600');
 }
 if (pathname === '/sitemap.xml') {
  const languageLinks=`<xhtml:link rel="alternate" hreflang="ko" href="${escapeHTML(origin)}/ko/"/><xhtml:link rel="alternate" hreflang="en" href="${escapeHTML(origin)}/en/"/><xhtml:link rel="alternate" hreflang="x-default" href="${escapeHTML(origin)}/"/>`;
  return send('application/xml; charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${['/','/ko/','/en/'].map(path=>`<url><loc>${escapeHTML(origin+path)}</loc>${languageLinks}</url>`).join('')}</urlset>`, 'public, max-age=3600');
 }
 if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) return false;
 const english=pathname==='/en/';
 const isHome = pathname === '/'||english||pathname==='/ko/';
 const isAppRoute = isHome || /^\/settings(?:\/(?:calendars(?:\/[a-zA-Z0-9_-]{2,50})?|icloud|google|migrate|account|preferences|sessions|shares))?\/?$/.test(pathname) || /^\/[a-zA-Z0-9_-]{2,50}\/?$/.test(pathname) || /^\/invite\/[a-zA-Z0-9_-]+\/?$/.test(pathname);
 if (!isAppRoute) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return send('text/plain; charset=utf-8', '페이지를 찾을 수 없습니다.', 'no-store', 404);
 }
 const robots = isHome ? 'index, follow, max-image-preview:large' : 'noindex, nofollow';
 res.setHeader('X-Robots-Tag', robots);
 let template=publicFile('/index.html').toString('utf8');
 if(pathname==='/ko/')template=template.replaceAll('"url":"__SITE_URL__/"','"url":"__SITE_URL__/ko/"').replaceAll('__SITE_URL__/#website','__SITE_URL__/ko/#website');
 if(english){
  template=translateSource(template).replace('<html lang="ko">','<html lang="en">').replace('content="ko_KR"','content="en_US"').replaceAll('"inLanguage":"ko"','"inLanguage":"en"').replaceAll('"url":"__SITE_URL__/"','"url":"__SITE_URL__/en/"').replaceAll('__SITE_URL__/#website','__SITE_URL__/en/#website');
  // Keep the installed app name consistent with the existing Android shortcut.
  template=template.replace('name="application-name" content="Moa Calendar"','name="application-name" content="모아 캘린더"').replace('name="apple-mobile-web-app-title" content="Moa Calendar"','name="apple-mobile-web-app-title" content="모아 캘린더"');
 }
 const html = template
  .replaceAll('__PAGE_URL__',escapeHTML(origin+(isHome?pathname:'/')))
  .replaceAll('__SITE_URL__', escapeHTML(origin))
  .replaceAll('__ROBOTS__', robots);
 return send('text/html; charset=utf-8', html);
}
