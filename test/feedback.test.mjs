import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const translations = readFileSync(new URL('../public/translations.js', import.meta.url), 'utf8');

test('feedback: top-right of calendar on desktop; on mobile it lives in the settings menu', () => {
  // Mobile feedback trigger is directly before mobile search trigger in topbar-actions
  const topbarIdx = appJs.indexOf('<div class="topbar-actions">');
  const mobileFeedbackIdx = appJs.indexOf('id="mobile-feedback-trigger"', topbarIdx);
  const mobileSearchIdx = appJs.indexOf('id="mobile-search-trigger"', topbarIdx);
  assert.ok(topbarIdx !== -1 && mobileFeedbackIdx !== -1 && mobileSearchIdx !== -1);
  assert.ok(mobileFeedbackIdx < mobileSearchIdx, 'mobile feedback button must be to the left of mobile search button');

  // Desktop feedback button is inside calendar-toolbar after dday-widget-bar
  const toolbarIdx = appJs.indexOf('<div class="calendar-toolbar">');
  const ddayIdx = appJs.indexOf('id="dday-widget-bar"', toolbarIdx);
  const desktopFeedbackIdx = appJs.indexOf('id="calendar-feedback-btn"', toolbarIdx);
  assert.ok(toolbarIdx !== -1 && ddayIdx !== -1 && desktopFeedbackIdx !== -1);
  assert.ok(desktopFeedbackIdx > ddayIdx, 'desktop feedback button must be at the right side of calendar-toolbar');

  // Dialog markup & modern web guidance compliance
  assert.match(html, /<dialog id="feedback-dialog" closedby="any" aria-labelledby="feedback-dialog-title">/);
  assert.match(html, /<form id="feedback-form" method="POST" action="\/api\/feedback"/);
  assert.match(html, /name="category" value="feature"/);
  assert.match(html, /name="category" value="bug"/);
  assert.match(html, /name="category" value="other"/);
  assert.match(html, /id="feedback-message"/);
  assert.match(html, /id="feedback-contact"/);

  // CSS rules for desktop/mobile visibility and modal scroll containment
  assert.match(css, /dialog:modal\{overscroll-behavior:contain\}/);
  assert.match(css, /\.calendar-feedback-btn\{[^}]*margin-left:auto/);
  assert.match(css, /\.mobile-feedback-trigger\{display:none\}/);
  assert.match(css, /@media\(max-width:600px\)\{[^}]*\.calendar-feedback-btn\{display:none\}[^}]*\.mobile-feedback-trigger\{display:flex/);

  // Mobile: header trigger is hidden to declutter; feedback is reachable from the settings menu
  assert.match(css, /\.topbar-actions \.mobile-feedback-trigger\{display:none\}/);
  assert.match(html, /id="settings-feedback-btn"/);
  assert.match(appJs, /\$\('#settings-feedback-btn'\)\.onclick=\(\)=>openFeedbackDialog\(\)/);

  // English translations exist
  assert.match(translations, /"기능 개선 · 버그 제보": "Feedback & Bug Report"/);
  assert.match(translations, /"소중한 의견을 보내주셔서 감사해요!": "Thank you for your feedback!"/);
});

test('POST /api/feedback validates input and forwards feedback to admin endpoint', async () => {
  const received = [];
  let mockStatus = 200;
  let mockBody = { success: true, id: 'fb_test_123', message: '피드백이 성공적으로 접수되었습니다.' };

  const mockAdmin = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: JSON.parse(raw || '{}')
      });
      res.writeHead(mockStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockBody));
    });
  });

  await new Promise(resolve => mockAdmin.listen(0, '127.0.0.1', resolve));
  const mockPort = mockAdmin.address().port;
  const prevFeedbackEndpoint = process.env.FEEDBACK_ENDPOINT;
  const prevAppUrl = process.env.APP_URL;
  process.env.FEEDBACK_ENDPOINT = `http://127.0.0.1:${mockPort}/api/feedback`;
  process.env.APP_URL = 'http://localhost:3000';

  try {
    const { handleRequest } = await import('../server.mjs');
    const appServer = http.createServer(handleRequest);
    await new Promise(resolve => appServer.listen(0, '127.0.0.1', resolve));
    const appPort = appServer.address().port;

    const postFeedback = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${appPort}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000',
          'X-Forwarded-For': '203.0.113.42',
          'User-Agent': 'MoaTestBrowser/1.0'
        },
        body: JSON.stringify(payload)
      });
      return { status: res.status, data: await res.json() };
    };

    try {
      // 1. Rejects empty message
      const emptyRes = await postFeedback({ category: 'bug', message: '   ' });
      assert.equal(emptyRes.status, 400);
      assert.equal(received.length, 0);

      // 2. Rejects oversized message
      const longRes = await postFeedback({ category: 'feature', message: 'a'.repeat(1901) });
      assert.equal(longRes.status, 400);
      assert.equal(received.length, 0);

      // 3. Forwards valid bug report to ../admin with formatted message and metadata
      const okRes = await postFeedback({
        category: 'bug',
        message: '달력에서 주간 보기 전환 시 스크롤이 튑니다.',
        contact: 'user@example.com',
        page: '/my-cal',
        client: 'web'
      });
      assert.equal(okRes.status, 200);
      assert.equal(okRes.data.ok, true);
      assert.equal(okRes.data.id, 'fb_test_123');
      assert.equal(received.length, 1);
      assert.equal(received[0].body.app, 'MoaCalendar');
      assert.equal(received[0].body.deviceId, 'web');
      assert.match(received[0].body.message, /^\[버그 제보\]\n달력에서 주간 보기 전환 시 스크롤이 튑니다\./);
      assert.match(received[0].body.message, /연락처: user@example\.com/);
      assert.match(received[0].body.message, /화면: \/my-cal/);
      assert.equal(received[0].headers['x-forwarded-for'], '203.0.113.42');
      assert.equal(received[0].headers['user-agent'], 'MoaTestBrowser/1.0');

      // 4. Maps upstream 429 rate-limit cleanly
      mockStatus = 429;
      mockBody = { success: false, error: '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.' };
      const rateRes = await postFeedback({ category: 'feature', message: '다크 모드 추가해 주세요' });
      assert.equal(rateRes.status, 429);

      // 5. Maps upstream 503 failure to 502
      mockStatus = 503;
      mockBody = { success: false, error: '저장하지 못했습니다.' };
      const errRes = await postFeedback({ category: 'other', message: '기타 의견입니다.' });
      assert.equal(errRes.status, 502);
    } finally {
      appServer.close();
    }
  } finally {
    mockAdmin.close();
    if (prevFeedbackEndpoint === undefined) delete process.env.FEEDBACK_ENDPOINT;
    else process.env.FEEDBACK_ENDPOINT = prevFeedbackEndpoint;
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
  }
});
